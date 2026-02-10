/**
 * Metadata Re-sync Service
 *
 * Provides comprehensive metadata auditing and synchronization:
 * 1. Audits all derived fields against core identity data
 * 2. Uses a small model (GPT-4o-mini) to decide what needs updating
 * 3. Uses the main model to regenerate affected fields and create linked persons
 *
 * The audit checks:
 * - Summary uses actual names (not "the sender/recipient")
 * - Hook uses actual names
 * - Sender exists as a linked person with role "sender"
 * - Recipient exists as a linked person with role "recipient"
 * - Relationship type is set if both sender and recipient are known
 */

import OpenAI from 'openai';
import { env, hasOpenAI } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ module: 'resync' });

const openai = hasOpenAI ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;

// Decision model - fast and cheap
const DECISION_MODEL = 'gpt-4o-mini';

// ============================================================================
// CONTROLLED VOCABULARY - Relationship Types
// ============================================================================
// These definitions follow OpenAI Cookbook's temporal agent pattern:
// Each type has a definition and examples to ensure consistent AI output.

export const RELATIONSHIP_TYPES = {
  'spouse': {
    definition: 'Married couple - husband and wife',
    examples: ['my dear wife', 'your loving husband', 'Mrs.', 'married']
  },
  'fiancé/fiancée': {
    definition: 'Engaged to be married, not yet wed',
    examples: ['my betrothed', 'future wife', 'engagement', 'wedding plans']
  },
  'romantic-partner': {
    definition: 'Romantic relationship, not engaged or married',
    examples: ['sweetheart', 'darling', 'my love', 'courting']
  },
  'parent': {
    definition: 'Parent writing to or about child',
    examples: ['my son', 'my daughter', 'your mother', 'your father']
  },
  'child': {
    definition: 'Child writing to or about parent',
    examples: ['dear mother', 'dear father', 'mom', 'dad', 'papa', 'mama']
  },
  'sibling': {
    definition: 'Brothers or sisters',
    examples: ['dear brother', 'dear sister', 'sis', 'bro']
  },
  'grandparent': {
    definition: 'Grandparent writing to or about grandchild',
    examples: ['my grandchild', 'grandmother', 'grandfather']
  },
  'grandchild': {
    definition: 'Grandchild writing to or about grandparent',
    examples: ['dear grandma', 'dear grandpa', 'grandmother', 'grandfather']
  },
  'aunt/uncle': {
    definition: 'Aunt or uncle relationship',
    examples: ['dear aunt', 'dear uncle', 'auntie']
  },
  'nephew/niece': {
    definition: 'Nephew or niece relationship',
    examples: ['my nephew', 'my niece']
  },
  'cousin': {
    definition: 'Cousin relationship',
    examples: ['dear cousin', 'my cousin']
  },
  'in-law': {
    definition: 'Related by marriage (mother-in-law, brother-in-law, etc.)',
    examples: ['mother-in-law', 'father-in-law', 'sister-in-law']
  },
  'friend': {
    definition: 'Close personal friend, non-romantic',
    examples: ['dear friend', 'old friend', 'my friend']
  },
  'acquaintance': {
    definition: 'Known person, not close friend or family',
    examples: ['Mr.', 'Mrs.', 'formal address', 'sir', 'madam']
  },
  'business-associate': {
    definition: 'Professional or business relationship',
    examples: ['colleague', 'partner', 'business matters', 'regards']
  },
  'employer': {
    definition: 'Writing to an employee',
    examples: ['your employer', 'the company', 'your position']
  },
  'employee': {
    definition: 'Writing to an employer',
    examples: ['my employer', 'the boss', 'work', 'job']
  },
  'unknown': {
    definition: 'Relationship cannot be determined from letter content',
    examples: []
  }
} as const;

export type RelationshipTypeKey = keyof typeof RELATIONSHIP_TYPES;

// Build relationship type documentation for prompts
function buildRelationshipTypesDocs(): string {
  const lines = ['ALLOWED RELATIONSHIP TYPES (use exactly one of these values):'];
  for (const [key, info] of Object.entries(RELATIONSHIP_TYPES)) {
    const examples = info.examples.length > 0
      ? ` (indicators: ${info.examples.slice(0, 3).join(', ')})`
      : '';
    lines.push(`  - "${key}": ${info.definition}${examples}`);
  }
  return lines.join('\n');
}

// ============================================================================
// TYPES
// ============================================================================

export interface IdentityChange {
  oldSender: string | null;
  newSender: string | null;
  oldRecipient: string | null;
  newRecipient: string | null;
}

export interface LinkedPersonInfo {
  canonicalName: string;
  role: 'sender' | 'recipient' | 'mentioned';
}

export interface MetadataAuditContext {
  sender: string | null;
  recipient: string | null;
  date: string | null;
  summary: string | null;
  hook: string | null;
  relationshipType: string | null;
  linkedPersons: LinkedPersonInfo[];
}

export interface ResyncDecision {
  shouldUpdateSummary: boolean;
  shouldUpdateHook: boolean;
  shouldCreateSenderPerson: boolean;
  shouldCreateRecipientPerson: boolean;
  shouldUpdateRelationship: boolean;
  issues: string[];
  reason: string;
}

export interface ResyncResult {
  summary: string | null;
  hook: string | null;
  senderPerson: { name: string; role: 'sender' } | null;
  recipientPerson: { name: string; role: 'recipient' } | null;
  relationshipType: string | null;
  wasUpdated: boolean;
}

// ============================================================================
// DECISION PROMPT - Full Metadata Audit
// ============================================================================

const DECISION_SYSTEM_PROMPT = `You are a metadata quality auditor for a historical letter archive. Your job is to check if the letter's derived metadata is consistent with its core identity fields.

You will be given:
- The core identity fields: sender name, recipient name, date
- The derived fields: summary, hook (teaser text)
- The linked persons: who is currently linked to this letter and in what role

Check each item and set the corresponding boolean to true if there's an issue:

1. **shouldUpdateSummary = true** if: The summary uses generic terms like "the sender", "the writer", "the recipient", "the addressee" when actual names are known.

2. **shouldUpdateHook = true** if: The hook uses generic terms instead of actual names when names are known.

3. **shouldCreateSenderPerson = true** if: We have a sender name BUT there is NO linked person with role="sender" that matches that name (case-insensitive).

4. **shouldCreateRecipientPerson = true** if: We have a recipient name BUT there is NO linked person with role="recipient" that matches that name (case-insensitive).

5. **shouldUpdateRelationship = true** if: Both sender and recipient are known but relationship type is not set.

IMPORTANT: The boolean values must directly reflect whether each issue exists. If you identify an issue in the "issues" list, the corresponding boolean MUST be true.

Return JSON:
{
  "shouldUpdateSummary": boolean,
  "shouldUpdateHook": boolean,
  "shouldCreateSenderPerson": boolean,
  "shouldCreateRecipientPerson": boolean,
  "shouldUpdateRelationship": boolean,
  "issues": ["list of specific issues found"],
  "reason": "brief overall summary"
}

Be thorough - flag any quality issues. This is about ensuring metadata consistency, not just detecting changes.`;

function buildDecisionPrompt(
  context: MetadataAuditContext,
  change?: IdentityChange
): string {
  const parts = [
    '=== CORE IDENTITY FIELDS ===',
    `Sender: ${context.sender || '(not set)'}`,
    `Recipient: ${context.recipient || '(not set)'}`,
    `Date: ${context.date || '(not set)'}`,
    '',
    '=== DERIVED TEXT FIELDS ===',
    `Summary: ${context.summary || '(empty)'}`,
    '',
    `Hook: ${context.hook || '(empty)'}`,
    '',
    '=== LINKED PERSONS ===',
  ];

  if (context.linkedPersons.length === 0) {
    parts.push('(none linked)');
  } else {
    for (const person of context.linkedPersons) {
      parts.push(`- ${person.canonicalName} (role: ${person.role})`);
    }
  }

  parts.push('');
  parts.push(`Relationship type: ${context.relationshipType || '(not set)'}`);

  // If there was a specific change, mention it
  if (change) {
    const changes: string[] = [];
    if (change.oldSender !== change.newSender) {
      changes.push(`Sender changed: "${change.oldSender || '(none)'}" → "${change.newSender || '(none)'}"`);
    }
    if (change.oldRecipient !== change.newRecipient) {
      changes.push(`Recipient changed: "${change.oldRecipient || '(none)'}" → "${change.newRecipient || '(none)'}"`);
    }
    if (changes.length > 0) {
      parts.push('');
      parts.push('=== RECENT CHANGES ===');
      parts.push(...changes);
    }
  }

  parts.push('');
  parts.push('Analyze all the above and identify any inconsistencies or missing data that should be fixed.');

  return parts.join('\n');
}

// ============================================================================
// REGENERATION PROMPT
// ============================================================================

// Build the regeneration prompt dynamically to include controlled vocabulary
function buildRegenerationSystemPrompt(): string {
  return `You regenerate and fix metadata fields for historical letters.

You will be given:
- The letter transcription
- The correct sender and recipient names
- A list of issues that need fixing
- Which fields to update

For each requested update, generate the corrected content.

## FIELD SPECIFICATIONS

### HOOK (if updating)
- 1-2 sentence teaser, max 150 characters
- Present tense, third person
- Focus on the most compelling human element
- ALWAYS use the actual names (e.g., "Jimmie writes to Molly..." not "The sender writes...")

### SUMMARY (if updating)
- Length proportional to letter content
- Factual description, neutral tone
- ALWAYS use the actual names throughout (never "the sender" or "the recipient")

### LINKED PERSONS (if creating)
- Return the person info needed to create the link

### RELATIONSHIP TYPE (if updating)
Infer relationship from letter content. You MUST use exactly one of these values:

${buildRelationshipTypesDocs()}

## OUTPUT SCHEMA

Return JSON with ONLY the fields being updated. Use null for fields not being updated.

\`\`\`json
{
  "summary": "string | null",
  "hook": "string | null",
  "senderPerson": { "name": "string" } | null,
  "recipientPerson": { "name": "string" } | null,
  "relationshipType": "spouse" | "fiancé/fiancée" | "romantic-partner" | "parent" | "child" | "sibling" | "grandparent" | "grandchild" | "aunt/uncle" | "nephew/niece" | "cousin" | "in-law" | "friend" | "acquaintance" | "business-associate" | "employer" | "employee" | "unknown" | null
}
\`\`\`

IMPORTANT: For relationshipType, use EXACTLY one of the allowed values above. Do not use variations like "romantic partners" or "romantic relationship" - use "romantic-partner" instead.`;
}

interface RegenerationRequest {
  transcript: string;
  sender: string | null;
  recipient: string | null;
  date: string | null;
  decision: ResyncDecision;
  currentSummary: string | null;
  currentHook: string | null;
}

function buildRegenerationPrompt(request: RegenerationRequest): string {
  const parts = [
    '<letter_transcription>',
    request.transcript,
    '</letter_transcription>',
    '',
    '<correct_identities>',
    `Sender: ${request.sender || '(unknown)'}`,
    `Recipient: ${request.recipient || '(unknown)'}`,
    `Date: ${request.date || '(unknown)'}`,
    '</correct_identities>',
    '',
    '<issues_to_fix>',
    ...request.decision.issues.map(issue => `- ${issue}`),
    '</issues_to_fix>',
    '',
    '<fields_to_update>',
  ];

  if (request.decision.shouldUpdateSummary) {
    parts.push(`Summary: YES (current: "${request.currentSummary || ''}")`);
  }
  if (request.decision.shouldUpdateHook) {
    parts.push(`Hook: YES (current: "${request.currentHook || ''}")`);
  }
  if (request.decision.shouldCreateSenderPerson) {
    parts.push(`Create sender person: YES (name: "${request.sender}")`);
  }
  if (request.decision.shouldCreateRecipientPerson) {
    parts.push(`Create recipient person: YES (name: "${request.recipient}")`);
  }
  if (request.decision.shouldUpdateRelationship) {
    parts.push('Infer relationship: YES');
  }

  parts.push('</fields_to_update>');
  parts.push('');
  parts.push('Fix the identified issues. Return JSON with only the fields being updated.');

  return parts.join('\n');
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Perform a full metadata audit to decide what needs updating.
 * Uses a fast, cheap model for the decision.
 *
 * This checks:
 * - Summary uses actual names (not generic terms)
 * - Hook uses actual names
 * - Sender is linked as a person
 * - Recipient is linked as a person
 * - Relationship type is set
 */
export async function auditMetadata(
  context: MetadataAuditContext,
  change?: IdentityChange
): Promise<ResyncDecision> {
  const logContext = {
    sender: context.sender,
    recipient: context.recipient,
    linkedPersonCount: context.linkedPersons.length,
    hasChange: !!change,
  };

  // Build default "no issues" response
  const noIssues: ResyncDecision = {
    shouldUpdateSummary: false,
    shouldUpdateHook: false,
    shouldCreateSenderPerson: false,
    shouldCreateRecipientPerson: false,
    shouldUpdateRelationship: false,
    issues: [],
    reason: 'No issues detected',
  };

  // Quick pre-checks (local, no AI needed)
  const hasSenderLinked = context.linkedPersons.some(
    p => p.role === 'sender' && p.canonicalName.toLowerCase() === context.sender?.toLowerCase()
  );
  const hasRecipientLinked = context.linkedPersons.some(
    p => p.role === 'recipient' && p.canonicalName.toLowerCase() === context.recipient?.toLowerCase()
  );

  // If no core identity data, nothing to audit
  if (!context.sender && !context.recipient) {
    return noIssues;
  }

  if (!hasOpenAI || !openai) {
    log.debug(logContext, 'Using stub audit (no API key)');

    // In stub mode, do simple local checks
    const issues: string[] = [];

    // Check for generic terms in summary
    if (context.summary) {
      const summaryLower = context.summary.toLowerCase();
      if (summaryLower.includes('the sender') || summaryLower.includes('the writer')) {
        issues.push('Summary uses generic term "the sender" instead of actual name');
      }
      if (summaryLower.includes('the recipient') || summaryLower.includes('the addressee')) {
        issues.push('Summary uses generic term "the recipient" instead of actual name');
      }
    }

    // Check linked persons
    if (context.sender && !hasSenderLinked) {
      issues.push(`Sender "${context.sender}" is not linked as a person`);
    }
    if (context.recipient && !hasRecipientLinked) {
      issues.push(`Recipient "${context.recipient}" is not linked as a person`);
    }

    if (issues.length === 0) {
      return noIssues;
    }

    return {
      shouldUpdateSummary: issues.some(i => i.includes('Summary')),
      shouldUpdateHook: issues.some(i => i.includes('Hook')),
      shouldCreateSenderPerson: context.sender ? !hasSenderLinked : false,
      shouldCreateRecipientPerson: context.recipient ? !hasRecipientLinked : false,
      shouldUpdateRelationship: false,
      issues,
      reason: `Found ${issues.length} issue(s) in stub mode`,
    };
  }

  log.debug(logContext, 'Requesting metadata audit from AI');
  const start = Date.now();

  try {
    const response = await openai.chat.completions.create({
      model: DECISION_MODEL,
      messages: [
        { role: 'system', content: DECISION_SYSTEM_PROMPT },
        { role: 'user', content: buildDecisionPrompt(context, change) },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 512,
      temperature: 0,
    });

    const duration = Date.now() - start;
    const content = response.choices[0]?.message?.content;

    if (!content) {
      log.warn({ ...logContext, duration }, 'No content in audit response');
      return noIssues;
    }

    const parsed = JSON.parse(content) as ResyncDecision;

    // Ensure issues array exists
    if (!parsed.issues) {
      parsed.issues = [];
    }

    // Local override: linked persons check is deterministic, don't rely on AI
    // This ensures we always create linked persons when they're missing
    if (context.sender && !hasSenderLinked && !parsed.shouldCreateSenderPerson) {
      log.debug({ sender: context.sender }, 'Overriding AI: sender not linked, forcing shouldCreateSenderPerson=true');
      parsed.shouldCreateSenderPerson = true;
      if (!parsed.issues.some(i => i.toLowerCase().includes('sender') && i.toLowerCase().includes('link'))) {
        parsed.issues.push(`Sender "${context.sender}" is not linked as a person`);
      }
    }
    if (context.recipient && !hasRecipientLinked && !parsed.shouldCreateRecipientPerson) {
      log.debug({ recipient: context.recipient }, 'Overriding AI: recipient not linked, forcing shouldCreateRecipientPerson=true');
      parsed.shouldCreateRecipientPerson = true;
      if (!parsed.issues.some(i => i.toLowerCase().includes('recipient') && i.toLowerCase().includes('link'))) {
        parsed.issues.push(`Recipient "${context.recipient}" is not linked as a person`);
      }
    }

    log.info(
      {
        ...logContext,
        duration,
        model: DECISION_MODEL,
        issueCount: parsed.issues.length,
        usage: response.usage,
      },
      'Metadata audit completed'
    );

    return parsed;
  } catch (error) {
    log.error({ ...logContext, err: error }, 'Metadata audit failed');
    throw error;
  }
}

/**
 * Legacy function name for backwards compatibility.
 * Now wraps auditMetadata.
 */
export async function decideResyncNeeded(
  change: IdentityChange,
  currentSummary: string | null,
  currentHook: string | null,
  linkedPersons: LinkedPersonInfo[] = []
): Promise<ResyncDecision> {
  const context: MetadataAuditContext = {
    sender: change.newSender,
    recipient: change.newRecipient,
    date: null,
    summary: currentSummary,
    hook: currentHook,
    relationshipType: null,
    linkedPersons,
  };

  return auditMetadata(context, change);
}

/**
 * Regenerate/fix metadata fields based on the audit decision.
 * Uses the main model for high-quality output.
 */
export async function regenerateMetadata(request: RegenerationRequest): Promise<ResyncResult> {
  const { decision } = request;

  const logContext = {
    sender: request.sender,
    recipient: request.recipient,
    updateSummary: decision.shouldUpdateSummary,
    updateHook: decision.shouldUpdateHook,
    createSender: decision.shouldCreateSenderPerson,
    createRecipient: decision.shouldCreateRecipientPerson,
    transcriptLength: request.transcript.length,
  };

  // Check if anything needs updating
  const needsWork =
    decision.shouldUpdateSummary ||
    decision.shouldUpdateHook ||
    decision.shouldCreateSenderPerson ||
    decision.shouldCreateRecipientPerson ||
    decision.shouldUpdateRelationship;

  if (!needsWork) {
    return {
      summary: null,
      hook: null,
      senderPerson: null,
      recipientPerson: null,
      relationshipType: null,
      wasUpdated: false,
    };
  }

  if (!hasOpenAI || !openai) {
    log.debug(logContext, 'Using stub regeneration (no API key)');
    return {
      summary: decision.shouldUpdateSummary
        ? `[STUB] ${request.sender || 'Someone'} writes to ${request.recipient || 'someone'} in this letter.`
        : null,
      hook: decision.shouldUpdateHook
        ? `[STUB] ${request.sender || 'Someone'} reaches out to ${request.recipient || 'someone'}.`
        : null,
      senderPerson: decision.shouldCreateSenderPerson && request.sender
        ? { name: request.sender, role: 'sender' as const }
        : null,
      recipientPerson: decision.shouldCreateRecipientPerson && request.recipient
        ? { name: request.recipient, role: 'recipient' as const }
        : null,
      relationshipType: decision.shouldUpdateRelationship ? 'unknown' : null,
      wasUpdated: true,
    };
  }

  log.debug(logContext, 'Regenerating metadata with AI');
  const start = Date.now();

  try {
    const response = await openai.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages: [
        { role: 'system', content: buildRegenerationSystemPrompt() },
        { role: 'user', content: buildRegenerationPrompt(request) },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 1024,
      temperature: 0.3,
    });

    const duration = Date.now() - start;
    const content = response.choices[0]?.message?.content;

    if (!content) {
      log.warn({ ...logContext, duration }, 'No content in regeneration response');
      return {
        summary: null,
        hook: null,
        senderPerson: null,
        recipientPerson: null,
        relationshipType: null,
        wasUpdated: false,
      };
    }

    const parsed = JSON.parse(content) as {
      summary?: string | null;
      hook?: string | null;
      senderPerson?: { name: string } | null;
      recipientPerson?: { name: string } | null;
      relationshipType?: string | null;
    };

    log.info(
      {
        ...logContext,
        duration,
        model: env.OPENAI_MODEL,
        summaryLength: parsed.summary?.length,
        hookLength: parsed.hook?.length,
        hasSenderPerson: !!parsed.senderPerson,
        hasRecipientPerson: !!parsed.recipientPerson,
        relationshipType: parsed.relationshipType,
        usage: response.usage,
      },
      'Metadata regenerated'
    );

    return {
      summary: decision.shouldUpdateSummary ? (parsed.summary || null) : null,
      hook: decision.shouldUpdateHook ? (parsed.hook || null) : null,
      senderPerson: decision.shouldCreateSenderPerson && parsed.senderPerson
        ? { name: parsed.senderPerson.name, role: 'sender' as const }
        : null,
      recipientPerson: decision.shouldCreateRecipientPerson && parsed.recipientPerson
        ? { name: parsed.recipientPerson.name, role: 'recipient' as const }
        : null,
      relationshipType: decision.shouldUpdateRelationship ? (parsed.relationshipType || null) : null,
      wasUpdated: true,
    };
  } catch (error) {
    log.error({ ...logContext, err: error }, 'Metadata regeneration failed');
    throw error;
  }
}

/**
 * Legacy function for backwards compatibility.
 */
export async function regenerateDerivedFields(
  transcript: string,
  sender: string | null,
  recipient: string | null,
  updateSummary: boolean,
  updateHook: boolean,
  currentSummary: string | null,
  currentHook: string | null
): Promise<ResyncResult> {
  const decision: ResyncDecision = {
    shouldUpdateSummary: updateSummary,
    shouldUpdateHook: updateHook,
    shouldCreateSenderPerson: false,
    shouldCreateRecipientPerson: false,
    shouldUpdateRelationship: false,
    issues: [],
    reason: 'Legacy call',
  };

  return regenerateMetadata({
    transcript,
    sender,
    recipient,
    date: null,
    decision,
    currentSummary,
    currentHook,
  });
}

/**
 * Full metadata sync flow:
 * 1. Audit all metadata for issues (fast model)
 * 2. Regenerate/fix anything that needs updating (main model)
 *
 * This is the main entry point for the re-sync feature.
 */
export async function resyncMetadata(params: {
  transcript: string;
  context: MetadataAuditContext;
  change?: IdentityChange;
}): Promise<ResyncResult & { decision: ResyncDecision }> {
  // Step 1: Audit metadata to find issues (fast model)
  const decision = await auditMetadata(params.context, params.change);

  // Step 2: Check if anything needs updating
  const needsWork =
    decision.shouldUpdateSummary ||
    decision.shouldUpdateHook ||
    decision.shouldCreateSenderPerson ||
    decision.shouldCreateRecipientPerson ||
    decision.shouldUpdateRelationship;

  if (!needsWork) {
    return {
      summary: null,
      hook: null,
      senderPerson: null,
      recipientPerson: null,
      relationshipType: null,
      wasUpdated: false,
      decision,
    };
  }

  // Step 3: Regenerate/fix the affected fields (main model)
  const result = await regenerateMetadata({
    transcript: params.transcript,
    sender: params.context.sender,
    recipient: params.context.recipient,
    date: params.context.date,
    decision,
    currentSummary: params.context.summary,
    currentHook: params.context.hook,
  });

  return {
    ...result,
    decision,
  };
}
