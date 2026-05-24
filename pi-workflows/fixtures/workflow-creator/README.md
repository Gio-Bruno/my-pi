# Workflow Creator fixtures

Source fixtures for `/workflow-creator` smoke-testing:

- `executing-plans/SKILL.md` — phase/gate-oriented skill conversion.
- `firecrawl-scrape/SKILL.md` — CLI-wrapper/script-heavy skill conversion.

Example invocations from `mr-01`:

```text
/workflow-creator pi-workflows/fixtures/workflow-creator/executing-plans/SKILL.md --name executing-plans
/workflow-creator pi-workflows/fixtures/workflow-creator/firecrawl-scrape/SKILL.md --name firecrawl-scrape
```
