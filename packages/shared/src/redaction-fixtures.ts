/** Shared, synthetic redaction corpus used by TypeScript and Python tests. */
export type RedactionFixture = Readonly<{
  name: string;
  input: Readonly<Record<string, unknown>>;
  expected: Readonly<Record<string, unknown>>;
}>;

export const REDACTION_FIXTURES: readonly RedactionFixture[] = [
  {
    name: "sensitive-nested-keys",
    input: { apiKey: "A08_FAKE_SENTINEL_KEY", nested: { prompt: "A08_FAKE_SENTINEL_PROMPT" } },
    expected: { apiKey: "[REDACTED]", nested: { prompt: "[REDACTED_PROMPT]" } },
  },
  {
    name: "bearer-in-message",
    input: { message: "Authorization: Bearer A08_FAKE_SENTINEL_TOKEN" },
    expected: { message: "Authorization: Bearer [REDACTED]" },
  },
  {
    name: "url-query-and-fragment",
    input: { url: "https://example.test/api/run?token=A08_FAKE_SENTINEL&next=1#fragment" },
    expected: { url: "https://example.test/[path]" },
  },
  {
    name: "windows-absolute-path",
    input: { path: "C:\\Users\\fixture\\SuperVideo\\clip.mp4" },
    expected: { path: "[REDACTED_PATH]" },
  },
  {
    name: "posix-absolute-path",
    input: { path: "/home/fixture/SuperVideo/clip.mp4" },
    expected: { path: "[REDACTED_PATH]" },
  },
] as const;
