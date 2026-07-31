export const DEVELOPMENT_STUB_TRANSCRIPTION_TEXT = `                              September 12, 1943

Dear [recipient],

I hope this letter finds you well.
[illegible] the weather has been quite
pleasant this [unclear: week/month].

The family sends their regards, and
we look forward to hearing from you
soon.

                    With warm regards,
                    [sender]

P.S. Tell everyone hello`;

export const DEVELOPMENT_STUB_TRANSCRIPTION_SHA256 =
  '57b797b6f99eb0d3f968248f91fb924db06c34a42c9abf9a1c6fafee3b2fec56';

export const DEVELOPMENT_STUB_PERSISTENCE_ERROR =
  'Development stub transcription was not persisted; configure OPENAI_API_KEY to create a reviewable transcript';

/**
 * Page-marker slicing can leave separator newlines around an otherwise exact
 * transcript. Ignore only those boundary newlines so edited or partial text is
 * never mistaken for the known development fixture.
 */
export function isDevelopmentStubTranscription(text: string): boolean {
  return text.replace(/^\n+|\n+$/g, '') === DEVELOPMENT_STUB_TRANSCRIPTION_TEXT;
}

export function assertPersistableTranscription(result: {
  isStub: boolean;
  text: string | null;
}): void {
  if (
    result.isStub
    || (
      result.text !== null
      && isDevelopmentStubTranscription(result.text)
    )
  ) {
    throw new Error(DEVELOPMENT_STUB_PERSISTENCE_ERROR);
  }
}
