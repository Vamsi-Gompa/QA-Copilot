from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from typing import List
import json
from models.schemas import (
    UserStory, UserStoryCreate, UserStoriesUpload, StorySplitRequest,
)
from services import storage
from agents.story_generator import generate_stories, ai_split_story

router = APIRouter()

# Defaults merged into legacy stories that predate the richer schema.
_STORY_DEFAULTS = {
    "project_name": "General",
    "acceptance_criteria": [],
    "story_points": 0,
    "priority": "medium",
    "status": "draft",
    "references": [],
}


@router.get("/", response_model=List[dict])
async def list_stories():
    return [{**_STORY_DEFAULTS, **s} for s in storage.get_stories().values()]


@router.post("/", response_model=UserStory)
async def create_story(body: UserStoryCreate):
    story = UserStory(**body.model_dump())
    storage.save_story(story)
    return story


@router.post("/bulk", response_model=List[UserStory])
async def bulk_create(body: UserStoriesUpload):
    created = []
    for s in body.stories:
        story = UserStory(**s.model_dump())
        storage.save_story(story)
        created.append(story)
    return created


@router.post("/generate")
async def generate_stories_endpoint(
    text: str = Form(""),
    count: int = Form(0),
    files: List[UploadFile] = File(default=[]),
):
    """
    Extract requirements from pasted text and/or uploaded documents & images,
    then generate draft user stories. Stories are returned for review — they are
    NOT saved until the client calls /bulk.
    """
    payloads: list[tuple[str, bytes]] = []
    for f in files or []:
        if not f:
            continue
        data = await f.read()
        if data:
            payloads.append((f.filename or "upload", data))

    if not payloads and not (text or "").strip():
        raise HTTPException(400, "Provide requirements text or at least one file.")

    result = await generate_stories(payloads, raw_text=text or "", count=count or 0)
    return result


@router.post("/ai-split")
async def ai_split_endpoint(body: StorySplitRequest):
    """Use the LLM to break one story into smaller INVEST stories (returns drafts)."""
    result = await ai_split_story(
        body.title,
        body.description,
        body.acceptance_criteria,
        parts=body.parts or 0,
        project_name=body.project_name or "General",
    )
    if not result["stories"]:
        raise HTTPException(
            422,
            "Could not split this story. " + (" | ".join(result.get("warnings", [])) or "Try again."),
        )
    return result


@router.post("/upload-file", response_model=List[UserStory])
async def upload_stories_file(file: UploadFile = File(...)):
    """Accept .txt, .json, or plain text user stories file (saved directly)."""
    content = await file.read()
    text = content.decode("utf-8", errors="replace")
    stories = _parse_stories_text(text)
    created = []
    for s in stories:
        story = UserStory(**s)
        storage.save_story(story)
        created.append(story)
    return created


@router.put("/{story_id}", response_model=UserStory)
async def update_story(story_id: str, body: UserStoryCreate):
    existing = storage.get_stories().get(story_id)
    if not existing:
        raise HTTPException(404, "Story not found")
    updated = UserStory(id=story_id, **body.model_dump(), created_at=existing["created_at"])
    storage.save_story(updated)
    return updated


@router.delete("/{story_id}")
async def delete_story(story_id: str):
    if story_id not in storage.get_stories():
        raise HTTPException(404, "Story not found")
    storage.delete_story(story_id)
    return {"deleted": story_id}


def _parse_stories_text(text: str) -> list:
    """Parse plain text stories into structured format."""
    # Try JSON first
    try:
        data = json.loads(text)
        if isinstance(data, list):
            return [
                {
                    "title": s.get("title", f"Story {i+1}"),
                    "project_name": s.get("project_name", s.get("project", "General")),
                    "description": s.get("description", s.get("story", "")),
                    "acceptance_criteria": s.get("acceptance_criteria", []),
                }
                for i, s in enumerate(data)
            ]
    except Exception:
        pass

    # Parse as numbered/bulleted plain text — split by blank lines or "Story N:"
    import re
    stories = []
    blocks = re.split(r'\n\s*\n+|\n(?=Story\s+\d+:)', text.strip())
    for i, block in enumerate(blocks):
        if not block.strip():
            continue
        lines = [l.strip() for l in block.strip().splitlines() if l.strip()]
        title = lines[0].lstrip("#*-0123456789. ") if lines else f"Story {i+1}"
        description = " ".join(lines[1:]) if len(lines) > 1 else title
        stories.append({
            "title": title[:200],
            "project_name": "General",
            "description": description[:1000],
            "acceptance_criteria": [],
        })
    return stories or [{
        "title": "Imported Story",
        "project_name": "General",
        "description": text[:500],
        "acceptance_criteria": [],
    }]
