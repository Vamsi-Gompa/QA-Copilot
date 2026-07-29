"""GitHub integration — push generated implementation files and optionally create a PR."""
import base64
import httpx
from typing import List, Dict, Any, Optional
from models.schemas import GeneratedTest


GITHUB_API = "https://api.github.com"


class GitHubService:
    def __init__(self, token: str, repo: str):
        self.token = token
        self.repo = repo
        self.headers = {
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github.v3+json",
            "Content-Type": "application/json",
        }

    async def get_default_branch(self) -> str:
        async with httpx.AsyncClient() as client:
            r = await client.get(f"{GITHUB_API}/repos/{self.repo}", headers=self.headers)
            r.raise_for_status()
            return r.json().get("default_branch", "main")

    async def repo_exists(self) -> bool:
        async with httpx.AsyncClient() as client:
            r = await client.get(f"{GITHUB_API}/repos/{self.repo}", headers=self.headers)
            return r.status_code == 200

    async def get_authenticated_user(self) -> str:
        async with httpx.AsyncClient() as client:
            r = await client.get(f"{GITHUB_API}/user", headers=self.headers)
            r.raise_for_status()
            return r.json().get("login", "")

    async def list_branches(self) -> List[str]:
        async with httpx.AsyncClient() as client:
            r = await client.get(f"{GITHUB_API}/repos/{self.repo}/branches", headers=self.headers)
            if r.status_code != 200:
                return []
            return [item.get("name") for item in r.json() if item.get("name")]

    async def create_repository(self, private: bool = True) -> bool:
        owner, _, name = self.repo.partition("/")
        if not owner or not name:
            return False

        login = await self.get_authenticated_user()
        endpoint = f"{GITHUB_API}/user/repos" if owner.lower() == login.lower() else f"{GITHUB_API}/orgs/{owner}/repos"
        async with httpx.AsyncClient() as client:
            r = await client.post(
                endpoint,
                headers=self.headers,
                json={"name": name, "private": private, "auto_init": True},
            )
            return r.status_code in (201, 422)

    async def get_ref_sha(self, branch: str) -> str:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{GITHUB_API}/repos/{self.repo}/git/refs/heads/{branch}",
                headers=self.headers,
            )
            r.raise_for_status()
            return r.json()["object"]["sha"]

    async def create_branch(self, new_branch: str, from_branch: str = "main") -> bool:
        sha = await self.get_ref_sha(from_branch)
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{GITHUB_API}/repos/{self.repo}/git/refs",
                headers=self.headers,
                json={"ref": f"refs/heads/{new_branch}", "sha": sha},
            )
            return r.status_code in (201, 422)  # 422 = already exists

    async def push_file(self, path: str, content: str, branch: str, message: str) -> bool:
        encoded = base64.b64encode(content.encode()).decode()
        # Check if file exists (to get sha for update)
        sha = None
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{GITHUB_API}/repos/{self.repo}/contents/{path}",
                headers=self.headers,
                params={"ref": branch},
            )
            if r.status_code == 200:
                sha = r.json().get("sha")

            payload: Dict[str, Any] = {
                "message": message,
                "content": encoded,
                "branch": branch,
            }
            if sha:
                payload["sha"] = sha

            r = await client.put(
                f"{GITHUB_API}/repos/{self.repo}/contents/{path}",
                headers=self.headers,
                json=payload,
            )
            return r.status_code in (200, 201)

    async def create_pull_request(self, branch: str, base: str, title: str, body: str) -> Optional[str]:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{GITHUB_API}/repos/{self.repo}/pulls",
                headers=self.headers,
                json={"title": title, "head": branch, "base": base, "body": body},
            )
            if r.status_code == 201:
                return r.json().get("html_url")
            return None

    async def push_tests(
        self,
        tests: List[GeneratedTest],
        branch: str,
        commit_message: str,
        create_pr: bool,
        pr_title: str,
        base_branch: str = "main",
        create_repo: bool = False,
        implementation_files: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        exists = await self.repo_exists()
        if not exists and create_repo:
            await self.create_repository(private=True)
            exists = await self.repo_exists()
        if not exists:
            raise RuntimeError(f"Repository not found: {self.repo}")

        default_branch = await self.get_default_branch()
        base = base_branch or default_branch
        if branch != base:
            await self.create_branch(branch, from_branch=base)

        pushed = []
        failed = []

        for item in implementation_files or []:
            path = item.get("path") or item.get("file_name")
            content = item.get("content", "")
            if not path or not str(content).strip():
                continue
            ok = await self.push_file(path, str(content), branch, commit_message)
            if ok:
                pushed.append(path)
            else:
                failed.append(path)

        for test in tests:
            fname = test.file_name or f"tests/{test.test_type}/{test.name}.py"
            ok = await self.push_file(fname, test.code, branch, commit_message)
            if ok:
                pushed.append(fname)
            else:
                failed.append(fname)

        pr_url = None
        if create_pr and pushed:
            impl_count = len(implementation_files or [])
            body_lines = [
                "## AI QA Copilot Changes",
                "",
                f"- Implementation files: {impl_count}",
            ]
            if tests:
                body_lines.append(f"- Test files: {len(tests)}")
            body_lines.extend(["", "### Files changed", *[f"- `{p}`" for p in pushed]])
            body = "\n".join(body_lines)
            pr_url = await self.create_pull_request(branch, base, pr_title, body)

        return {
            "pushed": pushed,
            "failed": failed,
            "pr_url": pr_url,
            "branch": branch,
        }
