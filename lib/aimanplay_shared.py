"""aimanplay.cn（菠萝 max）共享工具。

视频生成走 Bearer ``sk-`` 令牌；素材须先经 STS 上传到平台 OSS，再把公开 URL 写入提交体。
默认 OpenAI 风格 base 为 ``https://aimanplay.cn/v1``；STS 挂在站点根
``/api/video-upload/oss-sts``。
"""

from __future__ import annotations

AIMANPLAY_BASE_URL = "https://aimanplay.cn/v1"
_V1_SUFFIX = "/v1"


def resolve_aimanplay_api_key(api_key: str | None = None) -> str:
    if api_key is None or not api_key.strip():
        raise ValueError("请到系统配置页填写 aimanplay API Key")
    return api_key.strip()


def aimanplay_host(configured: str | None = None) -> str:
    """站点根（不含 ``/v1``），供 STS 等非 OpenAI 风格端点拼接。"""
    base = ((configured or "").strip() or AIMANPLAY_BASE_URL).rstrip("/")
    if base.endswith(_V1_SUFFIX):
        return base[: -len(_V1_SUFFIX)]
    return base


def aimanplay_base_url(configured: str | None = None) -> str:
    """OpenAI 兼容 base：``{host}/v1``。"""
    return f"{aimanplay_host(configured)}{_V1_SUFFIX}"


def aimanplay_auth_headers(api_key: str) -> dict[str, str]:
    """仅 Bearer；GET 下载成片不要带 Content-Type。"""
    return {"Authorization": f"Bearer {resolve_aimanplay_api_key(api_key)}"}


def aimanplay_json_headers(api_key: str) -> dict[str, str]:
    return {**aimanplay_auth_headers(api_key), "Content-Type": "application/json"}
