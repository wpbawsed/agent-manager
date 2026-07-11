// Minimal ambient types for the untyped @wpbawsed/agent-broker-core (reply.js).
// Only the surface Layer A uses for reply dispatch.
declare module "@wpbawsed/agent-broker-core" {
  export interface ReplyOpts {
    slackToken?: string;
    jiraBaseUrl?: string;
    jiraEmail?: string;
    jiraToken?: string;
    notionToken?: string;
    lineChannelToken?: string;
    [k: string]: unknown;
  }
  export interface ReplyTarget {
    channel: string; // protocol://target, e.g. slack://C123, jira://PROJ-1
    thread_ts?: string;
    metadata?: unknown;
  }
  export function dispatchReply(replyTo: ReplyTarget, text: string, opts?: ReplyOpts): Promise<unknown>;
  export function transitionJiraIssue(issueKey: string, namePattern: string, opts?: ReplyOpts): Promise<unknown>;
  export function parseReplyChannel(channel: string): { protocol: string; target: string };
}
