// Deterministic, seeded fixtures: 20 documents of an invented team's "Q4 planning" folder and their
// 300 comments. Same seed, same bytes. Nothing here is real: people, team and domain are made up
// (the .example TLD is reserved and never resolves).

import type { CommentReply, DocComment, MockDocument, MockDrive, Person } from "./model.js";

export const DEFAULT_SEED = 20261120;
export const TODAY = "2026-11-20T00:00:00.000Z";
/** T1's staleness cutoff (7 days before TODAY). No generated timestamp lands within 12 h of it. */
export const STALE_CUTOFF = "2026-11-13T00:00:00.000Z";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const CUTOFF_MS = Date.parse(STALE_CUTOFF);
const FIRST_MS = Date.parse("2026-09-01T08:00:00.000Z");
/** Latest time anything may happen: the evening before TODAY. */
const LAST_MS = Date.parse("2026-11-19T20:00:00.000Z");

/** mulberry32: tiny, fast and identical on every platform. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;
const between = (rng: Rng, min: number, max: number): number => min + rng() * (max - min);
const int = (rng: Rng, min: number, max: number): number => Math.floor(between(rng, min, max + 1));

const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const ID_CHARS_URL = `${ID_CHARS}-_`;
function randomId(rng: Rng, length: number, alphabet = ID_CHARS): string {
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(rng() * alphabet.length)];
  return out;
}

/** Keeps every timestamp at least 12 hours away from the T1 cutoff, so no answer hangs on rounding. */
function avoidCutoff(ms: number): number {
  return Math.abs(ms - CUTOFF_MS) < 12 * HOUR ? CUTOFF_MS + 12 * HOUR + (ms % HOUR) : ms;
}

/** Whole minutes plus a fixed seconds/millis part, as Drive returns them. */
function iso(ms: number): string {
  const rounded = Math.floor(ms / 60_000) * 60_000;
  return new Date(rounded).toISOString();
}

const TEAM = "Harbor Analytics";
const DOMAIN = "harbor-analytics.example";

const PEOPLE: readonly [string, number][] = [
  // name, relative weight as a commenter
  ["Alex Moreno", 3],
  ["Priya Raman", 5],
  ["Tomas Varga", 4],
  ["Hana Okafor", 4],
  ["Lucas Brandt", 3],
  ["Mei Ito", 3],
  ["Sofia Laurent", 2],
  ["Daniel Kowalski", 2],
  ["Grace Mbeki", 1],
];

function person(name: string, isMe: boolean): Person {
  const email = `${name.toLowerCase().replace(/\s+/g, ".")}@${DOMAIN}`;
  return { name, email, isMe };
}

/** Titles, each with the words its body talks about. Order is fixed; the first one is T2's document. */
const DOCUMENTS: readonly { title: string; topic: string; things: string[] }[] = [
  { title: "Budget 2027", topic: "the 2027 budget", things: ["the cloud spend line", "headcount costs", "the travel budget", "the contingency reserve", "the tooling licences"] },
  { title: "Q4 OKRs", topic: "our Q4 objectives", things: ["the activation key result", "the NPS target", "the revenue objective", "the reliability key result"] },
  { title: "Hiring plan Q4", topic: "Q4 hiring", things: ["the senior analyst role", "the data engineer opening", "the interview loop", "the referral bonus"] },
  { title: "Product roadmap 2027 H1", topic: "the H1 2027 roadmap", things: ["the alerts feature", "the self-serve exports", "the mobile dashboard", "the API v3 milestone"] },
  { title: "Pricing proposal 2027", topic: "the 2027 pricing", things: ["the starter tier", "the seat-based discount", "the annual plan", "the enterprise floor price"] },
  { title: "Data platform migration plan", topic: "the warehouse migration", things: ["the cutover weekend", "the dbt models", "the backfill job", "the rollback plan"] },
  { title: "Customer churn analysis Q3", topic: "Q3 churn", things: ["the cohort chart", "the SMB segment", "the exit survey", "the churn definition"] },
  { title: "Marketing launch plan: Insights 3.0", topic: "the Insights 3.0 launch", things: ["the launch date", "the webinar", "the press kit", "the landing page copy"] },
  { title: "Security review checklist", topic: "the security review", things: ["the access review", "the SSO rollout", "the vendor questionnaire", "the key rotation"] },
  { title: "Onboarding guide for new analysts", topic: "analyst onboarding", things: ["the first-week plan", "the SQL style guide", "the buddy system", "the laptop setup"] },
  { title: "Vendor evaluation: BI tools", topic: "the BI tool evaluation", things: ["the scoring matrix", "the trial results", "the licence quote", "the shortlist"] },
  { title: "Quarterly business review notes", topic: "the QBR", things: ["the pipeline slide", "the gross margin figure", "the customer quotes", "the risks section"] },
  { title: "Team offsite agenda", topic: "the offsite", things: ["the venue", "the Thursday workshop", "the dinner budget", "the travel dates"] },
  { title: "On-call rotation proposal", topic: "the on-call rotation", things: ["the paging policy", "the weekend shifts", "the escalation path", "the on-call allowance"] },
  { title: "Dashboard redesign spec", topic: "the dashboard redesign", things: ["the filter bar", "the empty states", "the colour palette", "the KPI tiles"] },
  { title: "Forecasting model v2 design", topic: "forecasting v2", things: ["the seasonality term", "the holdout window", "the feature list", "the error metric"] },
  { title: "Partner program outline", topic: "the partner program", things: ["the referral tier", "the revenue share", "the partner portal", "the certification"] },
  { title: "Support SLA revision", topic: "the support SLA", things: ["the first-response target", "the priority matrix", "the weekend coverage", "the credits clause"] },
  { title: "Engineering capacity plan Q4", topic: "Q4 capacity", things: ["the platform team allocation", "the tech-debt budget", "the holiday cover", "the contractor hours"] },
  { title: "Budget 2026 retrospective", topic: "the 2026 budget review", things: ["the overspend on cloud", "the unused training budget", "the forecast accuracy", "the vendor renewals"] },
];

/** Comments per document, in the order above. Sums to 300. */
const COMMENT_COUNTS = [26, 18, 15, 20, 17, 12, 16, 14, 11, 15, 13, 15, 10, 16, 19, 16, 12, 9, 14, 12];

const MONTHS = ["January", "February", "March", "April", "May", "June", "October", "November", "December"];

const SENTENCES = [
  "This section covers {thing} as part of {topic}.",
  "We expect {thing} to land by {month}, with a review in the following sprint.",
  "The current estimate for {thing} is {num} percent above last quarter.",
  "{owner} owns {thing} and will share an update at the next planning sync.",
  "Open question: should {thing} move to the {team} backlog or stay here?",
  "Last quarter {thing} took {num} working days end to end.",
  "We agreed to revisit {thing} once the numbers for {month} are in.",
  "The proposal keeps {thing} flat and moves {num} percent of the effort elsewhere.",
  "Risks for {thing}: unclear ownership, a tight timeline and missing data.",
  "For {topic}, {thing} is the item with the largest impact.",
  "A first draft of {thing} is linked in the appendix.",
  "Dependencies: {thing} needs sign-off from finance before {month}.",
];

const COMMENT_TEXTS = [
  "Can we double-check {thing}? The number looks off compared to last quarter.",
  "Who owns {thing}? I could not find a name in the tracker.",
  "I think {thing} needs a clearer definition before we commit.",
  "Is this still accurate after the last planning sync?",
  "Suggest we move {thing} to the appendix, it distracts from the main point.",
  "Do we have data to back this up?",
  "This conflicts with what we wrote in the roadmap. Which one is right?",
  "Please add a date here.",
  "Can you link the source for this figure?",
  "Nit: wording. Maybe 'by end of {month}' instead.",
  "I'd cut this sentence, it repeats the paragraph above.",
  "We should flag {thing} as a risk in the summary.",
  "Finance asked about this one in the last review.",
  "+1, but we need an owner before Friday.",
  "Not sure {num} percent is realistic. What is the assumption?",
];

const REPLY_TEXTS = [
  "Good catch, I'll update it.",
  "I'm on it, should be fixed by tomorrow.",
  "Checked with finance, the number is right.",
  "I don't think so, see the appendix.",
  "Agreed. Let's discuss in the sync.",
  "Added the link.",
  "Still waiting on data for this.",
  "Can you take this one?",
  "Updated, please have another look.",
  "Let's keep it for now and revisit next month.",
];

const RESOLVE_TEXTS = ["", "Done, thanks.", "Fixed.", "Resolved in the latest version.", "Closing, no longer relevant."];
const REOPEN_TEXTS = ["Reopening, this came back in the review.", "Reopening: the fix did not stick."];

function fill(template: string, rng: Rng, vars: { thing: string; topic: string; owner: string }): string {
  return template
    .replace(/\{thing\}/g, vars.thing)
    .replace(/\{topic\}/g, vars.topic)
    .replace(/\{owner\}/g, vars.owner)
    .replace(/\{team\}/g, pick(rng, ["platform", "growth", "finance", "insights"]))
    .replace(/\{month\}/g, pick(rng, MONTHS))
    .replace(/\{num\}/g, String(int(rng, 3, 40)));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function generateDrive(seed = DEFAULT_SEED): MockDrive {
  const rng = makeRng(seed);
  const people = PEOPLE.map(([name], i) => person(name, i === 0));
  const me = people[0]!;
  const weighted: Person[] = PEOPLE.flatMap(([, w], i) => Array.from({ length: w }, () => people[i]!));

  const usedIds = new Set<string>();
  const uniqueId = (prefix: string, length: number, alphabet?: string): string => {
    for (;;) {
      const id = prefix + randomId(rng, length, alphabet);
      if (!usedIds.has(id)) {
        usedIds.add(id);
        return id;
      }
    }
  };

  const documents: MockDocument[] = DOCUMENTS.map((spec, docIndex) => {
    const owner = pick(rng, people);
    const id = uniqueId("1", 43, ID_CHARS_URL);

    const paragraphs: string[] = [
      `${spec.title}`,
      `${TEAM} · Q4 planning folder. Owner: ${owner.name}. This document describes ${spec.topic}.`,
    ];
    const paragraphCount = int(rng, 8, 13);
    for (let p = 0; p < paragraphCount; p++) {
      const sentences = int(rng, 2, 4);
      const parts: string[] = [];
      for (let s = 0; s < sentences; s++) {
        parts.push(
          capitalize(fill(pick(rng, SENTENCES), rng, { thing: pick(rng, spec.things), topic: spec.topic, owner: pick(rng, people).name })),
        );
      }
      paragraphs.push(parts.join(" "));
    }
    const sentencesInBody = paragraphs.slice(2).flatMap((p) => p.split(/(?<=\.)\s+/));

    const comments: DocComment[] = [];
    const count = COMMENT_COUNTS[docIndex]!;
    for (let c = 0; c < count; c++) {
      const author = pick(rng, weighted);
      let t = avoidCutoff(Math.floor(between(rng, FIRST_MS, LAST_MS - 6 * HOUR)));
      const createdTime = iso(t);
      const thing = pick(rng, spec.things);
      const content = fill(pick(rng, COMMENT_TEXTS), rng, { thing, topic: spec.topic, owner: author.name });
      const quoted = rng() < 0.8 ? pick(rng, sentencesInBody) : undefined;
      const edited = rng() < 0.12 ? iso(Math.min(t + between(rng, 1, 20) * HOUR, LAST_MS)) : undefined;

      const wantResolved = rng() < 0.45;
      const wantReopened = !wantResolved && rng() < 0.06;
      const roll = rng();
      const replyCount = roll < 0.38 ? 0 : roll < 0.68 ? 1 : roll < 0.86 ? 2 : roll < 0.95 ? 3 : 4;

      const replies: CommentReply[] = [];
      const others = people.filter((p) => p !== author);
      const nextTime = (): number | undefined => {
        const n = avoidCutoff(t + Math.floor(between(rng, 0.1, 7) * DAY));
        return n > LAST_MS ? undefined : n;
      };
      const addReply = (fields: Partial<CommentReply> & { author: Person; content: string }): boolean => {
        const n = nextTime();
        if (n === undefined) return false;
        t = n;
        replies.push({
          id: uniqueId("AAAB", 7),
          createdTime: iso(t),
          deleted: false,
          ...fields,
        });
        return true;
      };

      for (let r = 0; r < replyCount; r++) {
        const replier = rng() < 0.3 ? author : pick(rng, others);
        if (!addReply({ author: replier, content: pick(rng, REPLY_TEXTS) })) break;
        if (rng() < 0.05) {
          const last = replies[replies.length - 1]!;
          last.deleted = true;
          last.content = "";
        }
      }

      let status: "open" | "resolved" = "open";
      if (wantResolved || wantReopened) {
        const resolver = rng() < 0.6 ? author : pick(rng, others);
        if (addReply({ author: resolver, content: pick(rng, RESOLVE_TEXTS), action: "resolve" })) {
          status = "resolved";
          if (wantReopened) {
            const reopener = pick(rng, people);
            if (addReply({ author: reopener, content: pick(rng, REOPEN_TEXTS), action: "reopen" })) status = "open";
          }
        }
      }

      const deleted = rng() < 0.04;
      const resolveReply = [...replies].reverse().find((r) => r.action === "resolve" && !r.deleted);
      comments.push({
        id: uniqueId("AAAB", 7),
        author,
        createdTime,
        ...(edited ? { modifiedTime: edited } : {}),
        content: deleted ? "" : content,
        ...(quoted ? { quotedText: quoted } : {}),
        status,
        deleted,
        replies,
        ...(status === "resolved" && resolveReply ? { resolution: { by: resolveReply.author, at: resolveReply.createdTime } } : {}),
      });
    }

    // Newest first, as list_comments returns them.
    comments.sort((a, b) => b.createdTime.localeCompare(a.createdTime) || a.id.localeCompare(b.id));

    const activity = comments.flatMap((c) => [c.createdTime, ...c.replies.map((r) => r.createdTime)]);
    const firstActivity = activity.reduce((min, x) => (x < min ? x : min), iso(LAST_MS));
    const lastActivity = activity.reduce((max, x) => (x > max ? x : max), "");
    const createdTime = iso(Date.parse(firstActivity) - Math.floor(between(rng, 2, 20) * DAY));
    const lastEditor = pick(rng, people);

    return {
      info: {
        id,
        name: spec.title,
        createdTime,
        modifiedTime: lastActivity || createdTime,
        owners: [owner],
        lastModifiedBy: lastEditor,
        webViewLink: `https://docs.google.com/document/d/${id}/edit`,
      },
      paragraphs,
      comments,
    };
  });

  return { seed, today: TODAY, folder: "Q4 planning", team: TEAM, me, people, documents };
}

/** Compares against the committed snapshot (server/fixtures/drive.json). */
export function serializeDrive(drive: MockDrive): string {
  return `${JSON.stringify(drive, null, 2)}\n`;
}
