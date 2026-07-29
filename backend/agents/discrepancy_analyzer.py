"""
Analyze test failures and propose fixes using the active LLM provider.
Uses Anthropic Claude when ANTHROPIC_API_KEY is set (via llm_service).
"""
import json
import re
from typing import List

from models.schemas import GeneratedTest, TestResult, Discrepancy
from services.llm_service import get_client, call_with_retry, provider_label

SYSTEM_PROMPT = """You are a senior QA engineer analyzing test failures.
For each failing test:
1. Explain what went wrong in plain English
2. Identify the root cause (code bug, test bug, environment issue, or data issue)
3. Propose a concrete fix
4. Rate severity: low (cosmetic), medium (functional), high (critical path broken)

Respond with ONLY valid JSON (no markdown):
{"analysis": "...", "root_cause": "...", "proposed_fix": "...", "severity": "low|medium|high"}"""


async def analyze_discrepancies(
    tests: List[GeneratedTest],
    results: List[TestResult],
) -> List[Discrepancy]:
    client = get_client()
    failing  = [r for r in results if r.status in ("failed", "error")]
    if not failing:
        return []

    test_map = {t.id: t for t in tests}
    discrepancies: List[Discrepancy] = []

    for result in failing:
        test = test_map.get(result.test_id)
        if not test:
            continue

        prompt = (
            f"TEST NAME: {test.name}\n"
            f"TEST TYPE: {test.test_type.value}\n"
            f"EXPECTED: {json.dumps(test.expected_results)}\n"
            f"CODE:\n```python\n{test.code[:2000]}\n```\n"
            f"ACTUAL OUTPUT: {result.actual_output or 'None'}\n"
            f"ERROR: {result.error_message or 'None'}"
        )

        try:
            response = await call_with_retry(
                client,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.2,
                max_tokens=512,
            )
            text = response.choices[0].message.content or "{}"
            json_match = re.search(r'\{.*\}', text, re.DOTALL)
            data = json.loads(json_match.group()) if json_match else {}
            discrepancies.append(Discrepancy(
                test_id=test.id,
                test_name=test.name,
                test_type=test.test_type.value,
                expected=test.expected_results,
                actual_output=result.actual_output,
                error=result.error_message,
                ai_analysis=data.get("analysis", text[:500]),
                proposed_fix=data.get("proposed_fix", ""),
                severity=data.get("severity", "medium"),
            ))
        except Exception as e:
            discrepancies.append(Discrepancy(
                test_id=test.id,
                test_name=test.name,
                test_type=test.test_type.value,
                expected=test.expected_results,
                actual_output=result.actual_output,
                error=result.error_message,
                ai_analysis=f"Analysis failed ({provider_label()}): {e}",
                severity="medium",
            ))

    return discrepancies
