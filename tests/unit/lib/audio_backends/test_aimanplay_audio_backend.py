"""aimanplay IndexTTS2 音频后端单测。"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from lib.audio_backends.aimanplay import DEFAULT_MODEL, AimanplayAudioBackend
from lib.audio_backends.base import AudioCapability, AudioSynthesisRequest, AudioSynthesisResult
from lib.providers import PROVIDER_AIMANPLAY


class TestAimanplayAudioBackend:
    def test_defaults_and_voices(self) -> None:
        with patch("lib.audio_backends.aimanplay.OpenAIAudioBackend") as cls:
            cls.return_value = MagicMock(model=DEFAULT_MODEL)
            backend = AimanplayAudioBackend(api_key="sk-test")
        assert backend.name == PROVIDER_AIMANPLAY
        assert backend.model == DEFAULT_MODEL
        assert backend.capabilities == {AudioCapability.TEXT_TO_SPEECH}
        assert {v.id for v in backend.list_voices()} == {
            "alloy",
            "echo",
            "fable",
            "onyx",
            "nova",
            "shimmer",
        }
        cls.assert_called_once()
        kwargs = cls.call_args.kwargs
        assert kwargs["api_key"] == "sk-test"
        assert kwargs["model"] == DEFAULT_MODEL
        assert kwargs["provider_name"] == PROVIDER_AIMANPLAY
        assert "aimanplay.cn" in kwargs["base_url"]

    @pytest.mark.asyncio
    async def test_synthesize_delegates(self, tmp_path: Path) -> None:
        out = tmp_path / "out.wav"
        expected = AudioSynthesisResult(
            provider=PROVIDER_AIMANPLAY,
            model=DEFAULT_MODEL,
            characters=4,
            output_path=out,
        )
        delegate = MagicMock()
        delegate.model = DEFAULT_MODEL
        delegate.synthesize = AsyncMock(return_value=expected)
        with patch("lib.audio_backends.aimanplay.OpenAIAudioBackend", return_value=delegate):
            backend = AimanplayAudioBackend(api_key="sk-test")
        req = AudioSynthesisRequest(
            text="你好世界",
            voice="alloy",
            language_type="Chinese",
            output_path=out,
        )
        result = await backend.synthesize(req)
        assert result is expected
        delegate.synthesize.assert_awaited_once_with(req)
