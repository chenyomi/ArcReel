"""AimanplayVideoBackend 单元测试（respx 捕获出站请求，假表压缩轮询等待）。"""

from __future__ import annotations

import json
from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path
from typing import NamedTuple

import httpx
import pytest
import respx

from lib.providers import PROVIDER_AIMANPLAY
from lib.video_backends.aimanplay import AimanplayVideoBackend, _map_platform_resolution
from lib.video_backends.base import VideoCapabilityError, VideoGenerationRequest
from tests.fakes import bounded_poll_clock

_BASE_URL = "https://aimanplay.cn/v1"
_HOST = "https://aimanplay.cn"
_OSS_HOST = "https://bucket.oss-cn-hangzhou.aliyuncs.com"


class _Routes(NamedTuple):
    sts: respx.Route
    oss_put: respx.Route
    create: respx.Route
    poll: respx.Route
    content: respx.Route


def _sts_body() -> dict:
    return {
        "success": True,
        "enabled": True,
        "host": _OSS_HOST,
        "region": "oss-cn-hangzhou",
        "bucket": "bucket",
        "dir": "uploads",
        "accessKeyId": "AKIDtest",
        "accessKeySecret": "secret",
        "securityToken": "token",
        "expiration": "2099-01-01T00:00:00Z",
    }


@contextmanager
def _aimanplay_api() -> Generator[_Routes]:
    with respx.mock(assert_all_called=False) as router:
        yield _Routes(
            sts=router.post(f"{_HOST}/api/video-upload/oss-sts"),
            oss_put=router.put(url__regex=rf"{_OSS_HOST}/uploads/.*"),
            create=router.post(f"{_BASE_URL}/videos"),
            poll=router.get(url__regex=rf"{_BASE_URL}/videos/[^/]+$"),
            content=router.get(url__regex=rf"{_BASE_URL}/videos/[^/]+/content$"),
        )


def _json(data: dict, status: int = 200) -> httpx.Response:
    return httpx.Response(status, json=data)


@pytest.fixture
def png_file(tmp_path: Path) -> Path:
    path = tmp_path / "ref.png"
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 32)
    return path


class TestResolutionMapping:
    def test_v5_portrait(self):
        assert _map_platform_resolution("minimax_h3_lightx2v_v5", "1080p", "9:16") == "1080p竖"

    def test_z0903_maps_1080_to_1088(self):
        assert _map_platform_resolution("minimax_h3_z0903", "1080p", "16:9") == "1088p横"

    def test_zm_u24_snaps_unsupported_1080_to_768(self):
        assert _map_platform_resolution("minimax_h3_zm_u24", "1080p", "16:9") == "768p横"


class TestCapabilities:
    def test_v5_r2v(self):
        caps = AimanplayVideoBackend.video_capabilities_for_model("minimax_h3_lightx2v_v5")
        assert caps.max_reference_images == 9
        assert caps.first_frame is False
        assert caps.audio_track.value == "always_on"

    def test_name_and_default_model(self):
        backend = AimanplayVideoBackend(api_key="sk-test")
        assert backend.name == PROVIDER_AIMANPLAY
        assert backend.model == "minimax_h3_lightx2v_v5"


class TestGenerate:
    @pytest.mark.asyncio
    async def test_reference_video_happy_path(self, png_file: Path, tmp_path: Path):
        out = tmp_path / "out.mp4"
        with _aimanplay_api() as routes, bounded_poll_clock():
            routes.sts.mock(return_value=_json(_sts_body()))
            routes.oss_put.mock(return_value=httpx.Response(200, content=b"ok"))
            routes.create.mock(return_value=_json({"id": "video_1", "status": "queued"}))
            routes.poll.mock(return_value=_json({"id": "video_1", "status": "completed", "progress": 100}))
            routes.content.mock(return_value=httpx.Response(200, content=b"mp4-bytes"))

            backend = AimanplayVideoBackend(api_key="sk-test", base_url=_BASE_URL)
            result = await backend.generate(
                VideoGenerationRequest(
                    prompt="雨中殡仪馆门口",
                    output_path=out,
                    duration_seconds=5,
                    resolution="1080p",
                    aspect_ratio="16:9",
                    reference_images=[png_file],
                    poll_timeout_seconds=30,
                )
            )

        assert result.provider == PROVIDER_AIMANPLAY
        assert result.task_id == "video_1"
        assert out.read_bytes() == b"mp4-bytes"
        payload = json.loads(routes.create.calls[0].request.content.decode())
        assert payload["model"] == "minimax_h3_lightx2v_v5"
        assert payload["resolution"] == "1080p横"
        assert payload["duration"] == 5
        assert payload["ref_image_0"].startswith(_OSS_HOST)
        assert "first_frame" not in payload

    @pytest.mark.asyncio
    async def test_text_to_video_skips_sts(self, tmp_path: Path):
        out = tmp_path / "out.mp4"
        with _aimanplay_api() as routes, bounded_poll_clock():
            routes.create.mock(return_value=_json({"id": "video_t", "status": "queued"}))
            routes.poll.mock(return_value=_json({"id": "video_t", "status": "completed", "progress": 100}))
            routes.content.mock(return_value=httpx.Response(200, content=b"mp4"))

            backend = AimanplayVideoBackend(
                api_key="sk-test",
                base_url=_BASE_URL,
                model="minimax_h3_lightx2v_no_pic",
            )
            await backend.generate(
                VideoGenerationRequest(
                    prompt="日落",
                    output_path=out,
                    duration_seconds=5,
                    resolution="768p",
                    aspect_ratio="9:16",
                    poll_timeout_seconds=30,
                )
            )

        assert routes.sts.call_count == 0
        assert routes.oss_put.call_count == 0
        payload = json.loads(routes.create.calls[0].request.content.decode())
        assert payload["model"] == "minimax_h3_lightx2v_no_pic"
        assert set(payload) >= {"model", "prompt", "duration", "resolution"}

    @pytest.mark.asyncio
    async def test_v5_requires_reference_image(self, tmp_path: Path):
        backend = AimanplayVideoBackend(api_key="sk-test", base_url=_BASE_URL)
        with pytest.raises(VideoCapabilityError) as exc:
            await backend.generate(
                VideoGenerationRequest(
                    prompt="x",
                    output_path=tmp_path / "o.mp4",
                    duration_seconds=5,
                    resolution="1080p",
                )
            )
        assert exc.value.code == "video_reference_images_required"

    @pytest.mark.asyncio
    async def test_failed_task(self, png_file: Path, tmp_path: Path):
        with _aimanplay_api() as routes, bounded_poll_clock():
            routes.sts.mock(return_value=_json(_sts_body()))
            routes.oss_put.mock(return_value=httpx.Response(200))
            routes.create.mock(return_value=_json({"id": "video_f", "status": "queued"}))
            routes.poll.mock(
                return_value=_json(
                    {
                        "id": "video_f",
                        "status": "failed",
                        "error": {"message": "存在未定义的参数", "code": "bad"},
                    }
                )
            )
            backend = AimanplayVideoBackend(api_key="sk-test", base_url=_BASE_URL)
            with pytest.raises(RuntimeError, match="存在未定义的参数"):
                await backend.generate(
                    VideoGenerationRequest(
                        prompt="x",
                        output_path=tmp_path / "o.mp4",
                        duration_seconds=5,
                        resolution="1080p",
                        reference_images=[png_file],
                        poll_timeout_seconds=30,
                    )
                )
