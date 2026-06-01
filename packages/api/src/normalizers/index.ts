export type { AgentEvent, NormalizeResult, Normalizer } from "./types.js";
export { slackNormalizer } from "./slack.js";
export { githubNormalizer } from "./github.js";
export { lineNormalizer } from "./line.js";
export { jiraNormalizer } from "./jira.js";
export { railwayNormalizer } from "./railway.js";
export { notionNormalizer } from "./notion.js";

import type { Normalizer } from "./types.js";
import { slackNormalizer } from "./slack.js";
import { githubNormalizer } from "./github.js";
import { lineNormalizer } from "./line.js";
import { jiraNormalizer } from "./jira.js";
import { railwayNormalizer } from "./railway.js";
import { notionNormalizer } from "./notion.js";

export const normalizers: Record<string, Normalizer> = {
  slack: slackNormalizer,
  github: githubNormalizer,
  line: lineNormalizer,
  jira: jiraNormalizer,
  railway: railwayNormalizer,
  notion: notionNormalizer,
};
