"""AimanplayAudioBackend — aimanplay.cn IndexTTS2 语音合成。

走 OpenAI 兼容 ``/v1/audio/speech``（New API 网关）；凭证与视频共用 aimanplay
``api_key`` / ``base_url``。模型默认 ``indextts2-v1``。
"""

from __future__ import annotations

from lib.aimanplay_shared import aimanplay_base_url, resolve_aimanplay_api_key
from lib.audio_backends.base import (
    AudioCapability,
    AudioSynthesisRequest,
    AudioSynthesisResult,
    VoiceOption,
)
from lib.audio_backends.openai import OpenAIAudioBackend
from lib.providers import PROVIDER_AIMANPLAY

DEFAULT_MODEL = "indextts2-v1"

# IndexTTS2 经网关时常映射为 OpenAI speech 的 voice 字段；具体可用音色以供应商为准。
# label 直接用 id，避免未核实的中文描述进 i18n。
_VOICE_CATALOG: tuple[VoiceOption, ...] = tuple(
    VoiceOption(id=voice_id, label=voice_id)
    for voice_id in (
        "alloy",
        "echo",
        "fable",
        "onyx",
        "nova",
        "shimmer",
    )
)


class AimanplayAudioBackend:
    """aimanplay IndexTTS2 语音合成后端（OpenAI 兼容 speech 路径）。"""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
    ) -> None:
        self._delegate = OpenAIAudioBackend(
            api_key=resolve_aimanplay_api_key(api_key),
            base_url=aimanplay_base_url(base_url),
            model=model or DEFAULT_MODEL,
            provider_name=PROVIDER_AIMANPLAY,
        )

    @property
    def name(self) -> str:
        return PROVIDER_AIMANPLAY

    @property
    def model(self) -> str:
        return self._delegate.model

    @property
    def capabilities(self) -> set[AudioCapability]:
        return {AudioCapability.TEXT_TO_SPEECH}

    def list_voices(self) -> list[VoiceOption]:
        return list(_VOICE_CATALOG)

    async def synthesize(self, request: AudioSynthesisRequest) -> AudioSynthesisResult:
        return await self._delegate.synthesize(request)
