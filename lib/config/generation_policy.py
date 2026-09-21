"""计费媒体策略：限制哪些 media_type 允许入队并打到供应商。

``paid_generation_media=video_only`` 时，只有视频任务可入队；图片 / 文本 / 配音
在入队闸口与解析闸口直接拒绝，Agent 与 WebUI 都绕不过。默认 ``all`` 保持原行为。
"""

from __future__ import annotations

from collections.abc import Mapping

from lib.api_errors import BadRequestError

PAID_GENERATION_MEDIA_KEY = "paid_generation_media"
PAID_GENERATION_MEDIA_ALL = "all"
PAID_GENERATION_MEDIA_VIDEO_ONLY = "video_only"

_ALLOWED_WHEN_VIDEO_ONLY = frozenset({"video"})
_TRUTHY_ALIASES = frozenset({"video_only", "video", "true", "1", "yes"})


def paid_generation_media(settings: Mapping[str, str]) -> str:
    raw = (settings.get(PAID_GENERATION_MEDIA_KEY) or "").strip().lower()
    if not raw or raw == PAID_GENERATION_MEDIA_ALL:
        return PAID_GENERATION_MEDIA_ALL
    if raw in _TRUTHY_ALIASES:
        return PAID_GENERATION_MEDIA_VIDEO_ONLY
    return PAID_GENERATION_MEDIA_ALL


def media_allowed_for_paid_generation(media_type: str, settings: Mapping[str, str]) -> bool:
    """``media_type`` 是否允许入队打供应商。"""
    if paid_generation_media(settings) != PAID_GENERATION_MEDIA_VIDEO_ONLY:
        return True
    return media_type.strip().lower() in _ALLOWED_WHEN_VIDEO_ONLY


def refuse_disallowed_paid_media(media_type: str, settings: Mapping[str, str]) -> None:
    """video_only 下非视频直接拒，调用方尚未打供应商。"""
    if media_allowed_for_paid_generation(media_type, settings):
        return
    raise BadRequestError("paid_generation_video_only", media_type=media_type)


async def assert_paid_media_allowed(media_type: str) -> None:
    """从全局 DB 读策略（worker / 无会话入口）。"""
    from lib.config.service import ConfigService
    from lib.db import safe_session_factory

    async with safe_session_factory() as session:
        settings = await ConfigService(session).get_all_settings()
    refuse_disallowed_paid_media(media_type, settings)
