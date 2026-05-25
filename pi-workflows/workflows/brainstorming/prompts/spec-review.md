Review the written design spec with fresh eyes.

Check:
1. Placeholder scan: no TBD, TODO, incomplete sections, or vague requirements.
2. Internal consistency: sections do not contradict each other; architecture matches feature descriptions.
3. Scope check: focused enough for a single implementation plan; decomposition noted if needed.
4. Ambiguity check: requirements should not be interpretable two different ways.

Fix issues inline in the returned revisedSpecMarkdown. If no fixes are needed, return the original markdown unchanged and passes=true.