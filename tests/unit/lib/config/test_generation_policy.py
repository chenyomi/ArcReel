"""paid_generation_media=video_only 时，非视频入队必须立刻拒绝。"""

from __future__ import annotations

import pytest

from lib.api_errors import BadRequestError
from lib.config.generation_policy import (
    PAID_GENERATION_MEDIA_KEY,
    PAID_GENERATION_MEDIA_VIDEO_ONLY,
    media_allowed_for_paid_generation,
    paid_generation_media,
    refuse_disallowed_paid_media,
)
from lib.config.service import ConfigService
from lib.generation_queue import GenerationQueue


class TestGenerationPolicyHelpers:
    def test_blank_means_all(self):
        assert paid_generation_media({}) == "all"
        assert media_allowed_for_paid_generation("image", {}) is True

    def test_video_only_blocks_non_video(self):
        settings = {PAID_GENERATION_MEDIA_KEY: PAID_GENERATION_MEDIA_VIDEO_ONLY}
        assert media_allowed_for_paid_generation("video", settings) is True
        assert media_allowed_for_paid_generation("image", settings) is False
        assert media_allowed_for_paid_generation("text", settings) is False
        assert media_allowed_for_paid_generation("audio", settings) is False

    def test_refuse_raises_bad_request(self):
        with pytest.raises(BadRequestError) as excinfo:
            refuse_disallowed_paid_media("image", {PAID_GENERATION_MEDIA_KEY: PAID_GENERATION_MEDIA_VIDEO_ONLY})
        assert excinfo.value.key == "paid_generation_video_only"


class TestEnqueueRespectsVideoOnly:
    async def test_image_enqueue_rejected(self, db_factory, monkeypatch):
        queue = GenerationQueue(session_factory=db_factory)
        async with db_factory() as session:
            await ConfigService(session).set_setting(PAID_GENERATION_MEDIA_KEY, PAID_GENERATION_MEDIA_VIDEO_ONLY)
            await session.commit()

        async def _ok(_name: str) -> None:
            return None

        monkeypatch.setattr(queue, "assert_project_migration_ok", _ok)

        with pytest.raises(BadRequestError) as excinfo:
            await queue.enqueue_task(
                project_name="proj-policy",
                task_type="character",
                media_type="image",
                resource_id="hero",
                payload={},
            )
        assert excinfo.value.key == "paid_generation_video_only"
