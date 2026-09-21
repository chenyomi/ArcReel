"""AimanplayVideoBackend — aimanplay.cn（菠萝 max）视频生成。

流程：本地素材 → STS + OSS 签名 PUT 拿公开 URL → ``POST /v1/videos`` → 轮询
``GET /v1/videos/{id}``（含 ``progress``）→ ``GET /v1/videos/{id}/content`` 落盘。

字段与枚举严格按平台文档；分辨率映射为 ``{档}竖/横/(1:1)``（超分档为 ``1088p``/``1440p``）。
"""

from __future__ import annotations

import asyncio
import base64
import email.utils
import hashlib
import hmac
import logging
import uuid
from dataclasses import dataclass
from pathlib import Path

import httpx

from lib.aimanplay_shared import (
    aimanplay_auth_headers,
    aimanplay_base_url,
    aimanplay_host,
    aimanplay_json_headers,
    resolve_aimanplay_api_key,
)
from lib.logging_utils import format_kwargs_for_log
from lib.providers import PROVIDER_AIMANPLAY
from lib.retry import (
    DEFAULT_BACKOFF_SECONDS,
    DEFAULT_MAX_ATTEMPTS,
    with_retry_async,
)
from lib.video_backends.base import (
    IMAGE_MIME_TYPES,
    ProviderJobIdPersistenceMixin,
    ReferenceAudioMode,
    ResumeExpiredError,
    VideoAudioMode,
    VideoCapabilities,
    VideoCapabilityError,
    VideoGenerationRequest,
    VideoGenerationResult,
    poll_with_retry,
    raise_for_status_redacted,
    recording_poll,
    should_retry_poll,
    should_retry_submit,
    submit_post,
    with_artifact_retry,
)

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "minimax_h3_lightx2v_v5"

_VIDEOS_ENDPOINT = "/videos"
_STS_PATH = "/api/video-upload/oss-sts"
_POLL_INTERVAL_SECONDS = 3.0
_SUBMIT_TIMEOUT_SECONDS = 60.0
_POLL_HTTP_TIMEOUT_SECONDS = 60.0
_DOWNLOAD_TIMEOUT_SECONDS = 120.0
_OSS_PUT_TIMEOUT_SECONDS = 120.0

_FAILED_STATUSES = frozenset({"failed", "error", "cancelled", "canceled"})

_AUDIO_MIME_TYPES: dict[str, str] = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
}


@dataclass(frozen=True)
class _ModelSpec:
    """单模型约束；与平台文档一一对应。"""

    max_reference_images: int
    max_reference_audio: int
    first_frame: bool
    last_frame: bool
    text_to_video: bool
    # ArcReel 侧分辨率档（对外 UI / registry）
    resolutions: frozenset[str]
    # 平台 resolution 前缀（可能与 ArcReel 档不同，如 1080→1088）
    platform_res_prefix: dict[str, str]
    supports_square: bool
    require_first_image: bool
    require_first_audio: bool
    audio_track: VideoAudioMode
    min_duration: int
    max_duration: int


_MODEL_SPECS: dict[str, _ModelSpec] = {
    "minimax_h3_lightx2v": _ModelSpec(
        max_reference_images=0,
        max_reference_audio=0,
        first_frame=True,
        last_frame=True,
        text_to_video=False,
        resolutions=frozenset({"480p", "768p"}),
        platform_res_prefix={"480p": "480p", "768p": "768p"},
        supports_square=True,
        require_first_image=False,
        require_first_audio=False,
        audio_track=VideoAudioMode.ALWAYS_ON,
        min_duration=1,
        max_duration=10,
    ),
    "minimax_h3_image_audio_to_video_v2_15s": _ModelSpec(
        max_reference_images=9,
        max_reference_audio=3,
        first_frame=False,
        last_frame=False,
        text_to_video=False,
        resolutions=frozenset({"480p", "768p"}),
        platform_res_prefix={"480p": "480p", "768p": "768p"},
        supports_square=False,
        require_first_image=False,
        require_first_audio=False,
        audio_track=VideoAudioMode.ALWAYS_ON,
        min_duration=1,
        max_duration=15,
    ),
    "minimax_h3_zm_u24": _ModelSpec(
        max_reference_images=9,
        max_reference_audio=3,
        first_frame=False,
        last_frame=False,
        text_to_video=False,
        resolutions=frozenset({"480p", "768p"}),
        platform_res_prefix={"480p": "480p", "768p": "768p"},
        supports_square=True,
        require_first_image=False,
        require_first_audio=False,
        audio_track=VideoAudioMode.ALWAYS_ON,
        min_duration=1,
        max_duration=15,
    ),
    "minimax_h3_lightx2v_v5": _ModelSpec(
        max_reference_images=9,
        max_reference_audio=0,
        first_frame=False,
        last_frame=False,
        text_to_video=False,
        resolutions=frozenset({"1080p"}),
        platform_res_prefix={"1080p": "1080p"},
        supports_square=True,
        require_first_image=True,
        require_first_audio=False,
        audio_track=VideoAudioMode.ALWAYS_ON,
        min_duration=1,
        max_duration=10,
    ),
    "minimax_h3_lightx2v_no_pic": _ModelSpec(
        max_reference_images=0,
        max_reference_audio=0,
        first_frame=False,
        last_frame=False,
        text_to_video=True,
        resolutions=frozenset({"480p", "768p"}),
        platform_res_prefix={"480p": "480p", "768p": "768p"},
        supports_square=True,
        require_first_image=False,
        require_first_audio=False,
        audio_track=VideoAudioMode.ALWAYS_ON,
        min_duration=1,
        max_duration=10,
    ),
    "minimax_h3_z0903": _ModelSpec(
        max_reference_images=6,
        max_reference_audio=3,
        first_frame=False,
        last_frame=False,
        text_to_video=False,
        resolutions=frozenset({"1080p", "1440p"}),
        platform_res_prefix={"1080p": "1088p", "1440p": "1440p"},
        supports_square=False,
        require_first_image=True,
        require_first_audio=True,
        audio_track=VideoAudioMode.ALWAYS_ON,
        min_duration=1,
        max_duration=15,
    ),
    "minimax_h3_z0902": _ModelSpec(
        max_reference_images=6,
        max_reference_audio=0,
        first_frame=False,
        last_frame=False,
        text_to_video=False,
        resolutions=frozenset({"1080p", "1440p"}),
        platform_res_prefix={"1080p": "1088p", "1440p": "1440p"},
        supports_square=False,
        require_first_image=True,
        require_first_audio=False,
        audio_track=VideoAudioMode.ALWAYS_OFF,
        min_duration=1,
        max_duration=15,
    ),
}


def _spec_for(model: str) -> _ModelSpec:
    spec = _MODEL_SPECS.get(model)
    if spec is None:
        raise VideoCapabilityError("video_capability_reference_unavailable", provider=PROVIDER_AIMANPLAY, model=model)
    return spec


def _orientation_suffix(aspect_ratio: str, *, supports_square: bool, model: str) -> str:
    normalized = (aspect_ratio or "").strip()
    if normalized in ("1:1", "1x1"):
        if not supports_square:
            raise VideoCapabilityError(
                "video_resolution_duration_unsupported",
                model=model,
                resolution="1:1",
                duration="n/a",
                supported="9:16,16:9",
            )
        return "(1:1)"
    if normalized in ("16:9", "16x9"):
        return "横"
    # 默认竖屏（9:16 及未知比例）
    return "竖"


def _map_platform_resolution(model: str, resolution: str | None, aspect_ratio: str) -> str:
    spec = _spec_for(model)
    preferred = "768p" if "768p" in spec.resolutions else sorted(spec.resolutions)[0]
    res = (resolution or preferred).lower()
    if res == "2k" and "1440p" in spec.resolutions:
        res = "1440p"
    elif res == "720p" and "768p" in spec.resolutions:
        res = "768p"
    if res not in spec.resolutions:
        logger.warning(
            "aimanplay model=%s 不支持 resolution=%s，吸附到 %s（支持 %s）",
            model,
            res,
            preferred,
            ",".join(sorted(spec.resolutions)),
        )
        res = preferred
    prefix = spec.platform_res_prefix[res]
    suffix = _orientation_suffix(aspect_ratio, supports_square=spec.supports_square, model=model)
    return f"{prefix}{suffix}"


def _safe_body_for_log(body: dict) -> dict:
    view: dict = {}
    for key in ("model", "duration", "resolution", "seed"):
        if key in body:
            view[key] = body[key]
    prompt = body.get("prompt")
    if isinstance(prompt, str):
        view["prompt_len"] = len(prompt)
    for key, value in body.items():
        if key.startswith(("ref_image_", "ref_audio_")) or key in ("first_frame", "last_frame"):
            view[key] = "<url>" if isinstance(value, str) else value
    return view


def _failure_reason(state: dict) -> str | None:
    if state.get("status") not in _FAILED_STATUSES:
        return None
    err = state.get("error")
    message = (err.get("message") or err.get("code") or "unknown") if isinstance(err, dict) else (err or "unknown")
    return f"aimanplay 视频生成失败: {message}"


def _mime_for_image(path: Path, *, model: str) -> str:
    mime = IMAGE_MIME_TYPES.get(path.suffix.lower())
    if mime is None:
        raise VideoCapabilityError(
            "video_reference_images_unreadable",
            model=model,
            names=path.name,
        )
    return mime


def _mime_for_audio(path: Path, *, model: str) -> str:
    mime = _AUDIO_MIME_TYPES.get(path.suffix.lower())
    if mime is None:
        raise VideoCapabilityError(
            "video_reference_audio_format_unsupported",
            model=model,
            name=path.name,
            supported=", ".join(sorted(_AUDIO_MIME_TYPES)),
        )
    return mime


def _oss_put_object(*, local_path: Path, content_type: str, sts: dict) -> str:
    """手写 OSS V1 签名 PUT；Date 槽位与 ``x-oss-date`` 同值（平台文档硬性要求）。"""
    date = email.utils.formatdate(usegmt=True)
    ext = local_path.suffix.lower().lstrip(".") or "bin"
    key = f"{sts['dir']}/{uuid.uuid4().hex}.{ext}"

    canonical_headers = "\n".join(
        sorted(
            [
                "x-oss-date:" + date,
                "x-oss-object-acl:public-read",
                "x-oss-security-token:" + sts["securityToken"],
            ]
        )
    )
    string_to_sign = "\n".join(
        [
            "PUT",
            "",
            content_type,
            date,
            canonical_headers,
            f"/{sts['bucket']}/{key}",
        ]
    )
    signature = base64.b64encode(
        hmac.new(
            sts["accessKeySecret"].encode("utf-8"),
            string_to_sign.encode("utf-8"),
            hashlib.sha1,
        ).digest()
    ).decode("utf-8")

    url = f"{sts['host'].rstrip('/')}/{key}"
    with local_path.open("rb") as handle:
        resp = httpx.put(
            url,
            content=handle,
            headers={
                "Authorization": f"OSS {sts['accessKeyId']}:{signature}",
                "Content-Type": content_type,
                "x-oss-date": date,
                "x-oss-object-acl": "public-read",
                "x-oss-security-token": sts["securityToken"],
            },
            timeout=_OSS_PUT_TIMEOUT_SECONDS,
        )
    if not resp.is_success:
        raise RuntimeError(f"aimanplay OSS PUT failed: {resp.status_code} {resp.text[:200]}")
    return url


class AimanplayVideoBackend(ProviderJobIdPersistenceMixin):
    """aimanplay 异步视频后端（STS 上传 + submit/poll + Bearer 成片下载）。"""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str | None = None,
        base_url: str | None = None,
        http_timeout: float = _POLL_HTTP_TIMEOUT_SECONDS,
    ) -> None:
        self._api_key = resolve_aimanplay_api_key(api_key)
        self._base_url = aimanplay_base_url(base_url)
        self._host = aimanplay_host(base_url)
        self._model = model or DEFAULT_MODEL
        self._http_timeout = http_timeout

    @property
    def name(self) -> str:
        return PROVIDER_AIMANPLAY

    @property
    def model(self) -> str:
        return self._model

    @staticmethod
    def video_capabilities_for_model(model: str) -> VideoCapabilities:
        spec = _spec_for(model)
        ref_audio = ReferenceAudioMode.DIRECT if spec.max_reference_audio > 0 else ReferenceAudioMode.NONE
        return VideoCapabilities(
            text_to_video=spec.text_to_video,
            first_frame=spec.first_frame,
            last_frame=spec.last_frame,
            max_reference_images=spec.max_reference_images,
            reference_audio_mode=ref_audio,
            max_reference_audio_count=spec.max_reference_audio,
            audio_track=spec.audio_track,
        )

    @staticmethod
    def effective_generate_audio_for_model(model: str) -> bool:
        return _spec_for(model).audio_track is not VideoAudioMode.ALWAYS_OFF

    @property
    def video_capabilities(self) -> VideoCapabilities:
        return self.video_capabilities_for_model(self._model)

    async def generate(self, request: VideoGenerationRequest) -> VideoGenerationResult:
        payload = await asyncio.to_thread(self._build_payload_with_uploads, request)
        logger.info(
            "调用 %s 视频 API model=%s body=%s",
            self.name,
            self._model,
            format_kwargs_for_log(_safe_body_for_log(payload)),
        )
        async with httpx.AsyncClient(timeout=self._http_timeout) as client:
            task_id = await self._create_task(client, payload, request)
            logger.info("aimanplay 视频任务已创建: task_id=%s model=%s", task_id, self._model)
            await self._persist_provider_job_id(request, task_id, provider=PROVIDER_AIMANPLAY)
            return await self._poll_and_build(client, task_id, request, is_resume=False)

    async def resume_video(self, job_id: str, request: VideoGenerationRequest) -> VideoGenerationResult:
        async with httpx.AsyncClient(timeout=self._http_timeout) as client:
            return await self._poll_and_build(client, job_id, request, is_resume=True)

    def _build_payload_with_uploads(self, request: VideoGenerationRequest) -> dict:
        spec = _spec_for(self._model)
        self._reject_out_of_range_duration(request.duration_seconds, spec)

        reference_images = self._valid_paths(request.reference_images)
        start_image = self._single_path(request.start_image)
        end_image = self._single_path(request.end_image)
        reference_audios = self._valid_paths(request.reference_audio_files)

        if reference_images and (start_image is not None or end_image is not None):
            raise VideoCapabilityError("video_reference_images_with_frames_unsupported", model=self._model)
        if end_image is not None and start_image is None:
            raise VideoCapabilityError("video_end_image_requires_start_image", model=self._model)
        if spec.max_reference_audio == 0 and reference_audios:
            raise VideoCapabilityError(
                "video_reference_audio_unsupported",
                provider=PROVIDER_AIMANPLAY,
                model=self._model,
            )

        if len(reference_images) > spec.max_reference_images:
            raise VideoCapabilityError(
                "video_reference_images_exceeded",
                model=self._model,
                count=len(reference_images),
                limit=spec.max_reference_images,
            )
        if len(reference_audios) > spec.max_reference_audio:
            raise VideoCapabilityError(
                "video_reference_audio_exceeded",
                model=self._model,
                count=len(reference_audios),
                limit=spec.max_reference_audio,
            )

        if spec.text_to_video and (reference_images or start_image or end_image or reference_audios):
            raise VideoCapabilityError(
                "video_reference_images_unsupported",
                model=self._model,
            )

        needs_upload = bool(reference_images or start_image or end_image or reference_audios)
        sts = self._fetch_sts() if needs_upload else None

        payload: dict = {
            "model": self._model,
            "prompt": request.prompt,
            "duration": request.duration_seconds,
            "resolution": _map_platform_resolution(self._model, request.resolution, request.aspect_ratio),
        }
        if request.seed is not None:
            payload["seed"] = request.seed

        if spec.first_frame:
            if start_image is None or end_image is None:
                raise VideoCapabilityError(
                    "video_capability_missing_i2v",
                    provider=PROVIDER_AIMANPLAY,
                    model=self._model,
                )
            assert sts is not None
            payload["first_frame"] = _oss_put_object(
                local_path=start_image, content_type=_mime_for_image(start_image, model=self._model), sts=sts
            )
            payload["last_frame"] = _oss_put_object(
                local_path=end_image, content_type=_mime_for_image(end_image, model=self._model), sts=sts
            )
            return payload

        if spec.max_reference_images > 0:
            if spec.require_first_image and not reference_images:
                raise VideoCapabilityError("video_reference_images_required", model=self._model)
            for index, path in enumerate(reference_images):
                assert sts is not None
                payload[f"ref_image_{index}"] = _oss_put_object(
                    local_path=path, content_type=_mime_for_image(path, model=self._model), sts=sts
                )

        if spec.max_reference_audio > 0:
            if spec.require_first_audio and not reference_audios:
                raise VideoCapabilityError(
                    "video_reference_audio_required",
                    model=self._model,
                )
            for index, path in enumerate(reference_audios):
                assert sts is not None
                payload[f"ref_audio_{index}"] = _oss_put_object(
                    local_path=path, content_type=_mime_for_audio(path, model=self._model), sts=sts
                )

        return payload

    def _fetch_sts(self) -> dict:
        resp = httpx.post(
            f"{self._host}{_STS_PATH}",
            headers=aimanplay_auth_headers(self._api_key),
            timeout=30.0,
        )
        raise_for_status_redacted(resp)
        sts = resp.json()
        if not isinstance(sts, dict) or not sts.get("success"):
            message = sts.get("message") if isinstance(sts, dict) else "unknown"
            raise RuntimeError(f"aimanplay STS 失败: {message}")
        for key in (
            "host",
            "region",
            "bucket",
            "dir",
            "accessKeyId",
            "accessKeySecret",
            "securityToken",
        ):
            if not sts.get(key):
                raise RuntimeError(f"aimanplay STS 响应缺少字段: {key}")
        return sts

    def _reject_out_of_range_duration(self, duration_seconds: int, spec: _ModelSpec) -> None:
        if not spec.min_duration <= duration_seconds <= spec.max_duration:
            raise VideoCapabilityError(
                "video_duration_not_supported",
                model=self._model,
                duration=duration_seconds,
                supported=f"{spec.min_duration}-{spec.max_duration}",
            )

    @staticmethod
    def _single_path(value: str | Path | None) -> Path | None:
        if value is None:
            return None
        text = str(value)
        if not text or text == ".":
            return None
        return Path(text)

    @classmethod
    def _valid_paths(cls, values: list[Path] | None) -> list[Path]:
        return [p for v in (values or []) if (p := cls._single_path(v)) is not None]

    @with_retry_async(
        max_attempts=DEFAULT_MAX_ATTEMPTS,
        backoff_seconds=DEFAULT_BACKOFF_SECONDS,
        retry_if=should_retry_submit,
    )
    async def _create_task(
        self, client: httpx.AsyncClient, payload: dict, request: VideoGenerationRequest | None = None
    ) -> str:
        resp = await submit_post(
            lambda: client.post(
                f"{self._base_url}{_VIDEOS_ENDPOINT}",
                json=payload,
                headers=aimanplay_json_headers(self._api_key),
                timeout=_SUBMIT_TIMEOUT_SECONDS,
            ),
            provider=PROVIDER_AIMANPLAY,
            request=request,
        )
        body = resp.json()
        task_id = body.get("id")
        if not isinstance(task_id, str) or not task_id:
            raise RuntimeError(f"aimanplay 视频提交返回体缺少 id（字段: {sorted(body)}）")
        return task_id

    async def _poll_once(self, client: httpx.AsyncClient, task_id: str) -> dict:
        resp = await client.get(
            f"{self._base_url}{_VIDEOS_ENDPOINT}/{task_id}",
            headers=aimanplay_auth_headers(self._api_key),
        )
        raise_for_status_redacted(resp)
        return resp.json()

    async def _poll_and_build(
        self,
        client: httpx.AsyncClient,
        task_id: str,
        request: VideoGenerationRequest,
        *,
        is_resume: bool,
    ) -> VideoGenerationResult:
        recorded_poll = recording_poll(lambda: self._poll_once(client, task_id), request)

        async def _gated_poll() -> dict:
            try:
                return await recorded_poll()
            except httpx.HTTPStatusError as exc:
                if is_resume and exc.response.status_code == 404:
                    raise ResumeExpiredError(job_id=task_id, provider=PROVIDER_AIMANPLAY) from exc
                raise

        await poll_with_retry(
            poll_fn=_gated_poll,
            is_done=lambda state: state.get("status") in ("completed", "failed"),
            is_failed=_failure_reason,
            max_wait=request.poll_timeout_seconds,
            poll_interval=_POLL_INTERVAL_SECONDS,
            retry_if=should_retry_poll,
            label="aimanplay",
            on_progress=lambda v, elapsed: logger.info(
                "aimanplay 视频生成中... status=%s progress=%s elapsed=%ds",
                v.get("status"),
                v.get("progress"),
                int(elapsed),
            ),
        )

        await self._download_content(client, task_id, request)
        logger.info("aimanplay 视频下载完成: %s", request.output_path)

        return VideoGenerationResult(
            video_path=request.output_path,
            provider=PROVIDER_AIMANPLAY,
            model=self._model,
            duration_seconds=request.duration_seconds,
            task_id=task_id,
            seed=request.seed,
            generate_audio=self.effective_generate_audio_for_model(self._model),
        )

    async def _download_content(self, client: httpx.AsyncClient, task_id: str, request: VideoGenerationRequest) -> None:
        async def fetch() -> bytes:
            resp = await client.get(
                f"{self._base_url}{_VIDEOS_ENDPOINT}/{task_id}/content",
                headers=aimanplay_auth_headers(self._api_key),
                timeout=_DOWNLOAD_TIMEOUT_SECONDS,
            )
            raise_for_status_redacted(resp)
            return resp.content

        content = await with_artifact_retry(
            fetch,
            label="aimanplay content",
            retry_if=should_retry_poll,
            max_wait=request.poll_timeout_seconds,
        )

        def _write() -> None:
            request.output_path.parent.mkdir(parents=True, exist_ok=True)
            request.output_path.write_bytes(content)

        await asyncio.to_thread(_write)
