#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  TextRun,
} from "docx";
import JSZip from "jszip";

export const BUSINESS_RESULT_SCHEMA = "thoughtseed.temperance.business_execution.v1";
export const BUSINESS_ERROR_SCHEMA = "thoughtseed.temperance.business_error.v1";
export const NATIVE_SCHEMA = "thoughtseed.hermes.native_execution.v1";
export const INPUT_SCHEMA = "thoughtseed.legal.service_agreement_draft_input.v1";
export const WORKFLOW_ID = "thoughtseed.legal.service-agreement.draft.v1";
export const COMMAND = "service_agreement.draft.render";
export const POLICY_SCHEMA = "thoughtseed.temperance.service_agreement_policy.v1";
export const ARTIFACT_SCHEMA = "thoughtseed.business_artifact.v1";

const SAFE_ID = /^[A-Za-z0-9._:-]{1,256}$/;
const EXTERNAL_ACTION = /\b(?:email|send|deliver|publish|signature|signing|e-?sign|whatsapp|telegram)\b/i;
const CONTENT_POLICY_ID = "anthropic-skills:thoughtseed-contract-generator@1";
const RENDERER_POLICY_ID = "thoughtseed.docx.legal.a4.v1";
const CONTENT_POLICY_DIGEST = "sha256:b34b87ac93681a9acb4127ebdeb3030eccf4f9b6e2f8119b21326fdf3ffe9a13";
const RENDERER_POLICY_DIGEST = "sha256:ab11e39c744ac22dd6ee88b50f7fd275954ce4dd6bebd44590844b1f6ac6f453";
const CLIENT_DISPLAY_NAME = "Thoughtseed Systems Test Client";

export class BusinessContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BusinessContractError";
    this.code = code;
  }
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function digestBytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function digestCanonical(value) {
  return digestBytes(Buffer.from(canonicalJson(value), "utf8"));
}

export function validatePolicy(raw) {
  const policy = exactObject(raw, "policy", ["schema", "workflowId", "command", "contentPolicy", "rendererPolicy"]);
  equal(policy.schema, POLICY_SCHEMA, "policy.schema");
  equal(policy.workflowId, WORKFLOW_ID, "policy.workflowId");
  equal(policy.command, COMMAND, "policy.command");
  const content = exactObject(policy.contentPolicy, "policy.contentPolicy", ["id", "digest", "spec"]);
  equal(content.id, CONTENT_POLICY_ID, "policy.contentPolicy.id");
  equal(content.digest, CONTENT_POLICY_DIGEST, "policy.contentPolicy.digest");
  equal(digestCanonical(content.spec), CONTENT_POLICY_DIGEST, "policy.contentPolicy.spec digest");
  const renderer = exactObject(policy.rendererPolicy, "policy.rendererPolicy", ["id", "digest", "spec"]);
  equal(renderer.id, RENDERER_POLICY_ID, "policy.rendererPolicy.id");
  equal(renderer.digest, RENDERER_POLICY_DIGEST, "policy.rendererPolicy.digest");
  equal(digestCanonical(renderer.spec), RENDERER_POLICY_DIGEST, "policy.rendererPolicy.spec digest");
  return policy;
}

export function validateDirective(raw, expectedMemberId) {
  const directive = exactObject(raw, "directive", ["id", "memberId", "idempotencyKey", "payload"]);
  safeId(directive.id, "directive.id");
  equal(directive.memberId, expectedMemberId, "directive.memberId");
  safeId(directive.idempotencyKey, "directive.idempotencyKey");
  const payload = exactObject(directive.payload, "directive.payload", ["type", "schema", "command", "target", "input"]);
  equal(payload.type, "native_execution", "directive.payload.type");
  equal(payload.schema, NATIVE_SCHEMA, "directive.payload.schema");
  equal(payload.command, COMMAND, "directive.payload.command");
  const target = exactObject(payload.target, "directive.payload.target", ["memberId"]);
  equal(target.memberId, expectedMemberId, "directive.payload.target.memberId");
  const input = validateInput(payload.input);
  return {
    id: directive.id,
    memberId: directive.memberId,
    idempotencyKey: directive.idempotencyKey,
    payload: { type: "native_execution", schema: NATIVE_SCHEMA, command: COMMAND, target, input },
  };
}

export function validateInput(raw) {
  const input = exactObject(raw, "input", [
    "schema",
    "workflowId",
    "tenantId",
    "projectId",
    "clientId",
    "gsdTaskId",
    "synthetic",
    "intent",
    "documentKind",
    "clientDisplayName",
    "projectName",
    "projectSummary",
    "engagementType",
    "currency",
    "feeMinor",
    "deliverables",
    "outOfScope",
    "approval",
    "externalAction",
  ]);
  equal(input.schema, INPUT_SCHEMA, "input.schema");
  equal(input.workflowId, WORKFLOW_ID, "input.workflowId");
  for (const key of ["tenantId", "projectId", "clientId", "gsdTaskId"]) safeId(input[key], `input.${key}`);
  equal(input.tenantId, "thoughtseed", "input.tenantId");
  equal(input.synthetic, true, "input.synthetic");
  equal(input.documentKind, "service_agreement", "input.documentKind");
  equal(input.clientDisplayName, CLIENT_DISPLAY_NAME, "input.clientDisplayName");
  text(input.intent, "input.intent", 1, 240);
  if (EXTERNAL_ACTION.test(input.intent)) fail("external_action_forbidden", "input.intent requests a prohibited external action");
  text(input.projectName, "input.projectName", 1, 120);
  text(input.projectSummary, "input.projectSummary", 1, 600);
  equal(input.engagementType, "fixed_price", "input.engagementType");
  equal(input.currency, "INR", "input.currency");
  if (!Number.isSafeInteger(input.feeMinor) || input.feeMinor < 100 || input.feeMinor > 100_000_000_00) {
    fail("invalid_field", "input.feeMinor must be a bounded positive safe integer");
  }
  input.deliverables = stringList(input.deliverables, "input.deliverables", 1, 8, 180);
  input.outOfScope = stringList(input.outOfScope, "input.outOfScope", 1, 8, 180);
  const approval = exactObject(input.approval, "input.approval", ["scope", "observationId", "observedAt"]);
  equal(approval.scope, "internal_canary_draft_only", "input.approval.scope");
  safeId(approval.observationId, "input.approval.observationId");
  isoDate(approval.observedAt, "input.approval.observedAt");
  equal(input.externalAction, "none", "input.externalAction");
  return input;
}

export async function renderServiceAgreement(rawDirective, rawPolicy, outputDir, expectedMemberId) {
  const directive = validateDirective(rawDirective, expectedMemberId);
  const policy = validatePolicy(rawPolicy);
  const input = directive.payload.input;
  const artifactId = `artifact_${createHash("sha256").update(`${input.gsdTaskId}\0${NATIVE_SCHEMA}`).digest("hex").slice(0, 32)}`;
  const fileName = `Service_Agreement_${artifactId}_DRAFT.docx`;
  const outputPath = join(outputDir, fileName);
  const document = createDocument(input);
  const packed = await Packer.toBuffer(document);
  const bytes = await canonicalizeDocx(packed, input.approval.observedAt);
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  try {
    await writeFile(outputPath, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "EEXIST") throw error;
    const existing = await readFile(outputPath);
    if (digestBytes(existing) !== digestBytes(bytes)) {
      fail("artifact_idempotency_conflict", "existing artifact bytes differ for stable artifact identity");
    }
  }
  const stored = await readFile(outputPath);
  const artifactDigest = digestBytes(stored);
  return {
    schema: BUSINESS_RESULT_SCHEMA,
    status: "rendered",
    workflowId: WORKFLOW_ID,
    gsdTaskId: input.gsdTaskId,
    approvalState: "awaiting_human_approval",
    synthetic: true,
    externalAction: "none",
    artifact: {
      schema: ARTIFACT_SCHEMA,
      id: artifactId,
      path: outputPath,
      fileName,
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      byteLength: stored.byteLength,
      digest: artifactDigest,
    },
    policies: {
      policySchema: policy.schema,
      contentPolicyId: policy.contentPolicy.id,
      contentPolicyDigest: policy.contentPolicy.digest,
      rendererPolicyId: policy.rendererPolicy.id,
      rendererPolicyDigest: policy.rendererPolicy.digest,
      fallbackPolicy: "fail_closed",
    },
  };
}

async function canonicalizeDocx(packed, observedAt) {
  const source = await JSZip.loadAsync(packed);
  const canonical = new JSZip();
  const timestamp = new Date(observedAt);
  const entries = Object.values(source.files).sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    let bytes = entry.dir ? new Uint8Array(0) : await entry.async("uint8array");
    if (entry.name === "docProps/core.xml") {
      const xml = new TextDecoder().decode(bytes)
        .replace(/(<dcterms:created[^>]*>)[^<]*(<\/dcterms:created>)/, `$1${observedAt}$2`)
        .replace(/(<dcterms:modified[^>]*>)[^<]*(<\/dcterms:modified>)/, `$1${observedAt}$2`);
      bytes = new TextEncoder().encode(xml);
    }
    canonical.file(entry.name, bytes, {
      dir: entry.dir,
      date: timestamp,
      compression: entry.dir ? "STORE" : "DEFLATE",
      unixPermissions: entry.unixPermissions,
      dosPermissions: entry.dosPermissions,
    });
  }
  return canonical.generateAsync({
    type: "nodebuffer",
    platform: "UNIX",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

function createDocument(input) {
  const warning = "SYSTEM CANARY — DRAFT — NOT FOR SIGNATURE OR EXTERNAL USE";
  const body = (textValue, options = {}) => {
    const { run = {}, spacing = {}, ...paragraph } = options;
    return new Paragraph({
      ...paragraph,
      spacing: { line: 360, after: 160, ...spacing },
      children: [new TextRun({ text: textValue, font: "Times New Roman", size: 22, ...run })],
    });
  };
  const heading = (textValue) => new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 240, after: 140 },
    children: [new TextRun({ text: textValue, font: "Times New Roman", size: 24, bold: true })],
  });
  const list = (items) => items.map((item, index) => body(`${index + 1}. ${item}`, { indent: { left: 360 } }));
  const fee = new Intl.NumberFormat("en-IN", { style: "currency", currency: input.currency }).format(input.feeMinor / 100);
  const children = [
    body(warning, { alignment: AlignmentType.CENTER, run: { bold: true, color: "B91C1C", size: 24 } }),
    body("SERVICE AGREEMENT", { alignment: AlignmentType.CENTER, run: { bold: true, size: 32 } }),
    body("Internal pipeline proof generated under a synthetic counterparty. This document cannot be signed, delivered, published, or relied upon as legal advice.", { alignment: AlignmentType.CENTER, run: { italic: true, color: "7F1D1D" } }),
    heading("PARTIES"),
    body(`${input.clientDisplayName} (synthetic system-canary counterparty; not a legal entity), hereinafter the “Client”; and ThoughtSeed Private Limited, Bengaluru, Karnataka, India, hereinafter the “Service Provider”.`),
    heading("RECITALS"),
    body(`The Service Provider is engaged in technology development and consulting. The synthetic Client requests an internal proof draft for ${input.projectName}. The parties are not entering a legal relationship through this canary.`),
    heading("1. SCOPE OF SERVICES"),
    body("The Service Provider would render only the services listed in Appendix A. Work not listed there would require a separate written agreement and approved commercial terms."),
    heading("2. FEES AND PAYMENT"),
    body(`Synthetic fixed-price reference amount: ${fee}. No invoice, payment request, tax liability, or collection action is created by this system canary.`),
    heading("3. TERM AND TERMINATION"),
    body("A real agreement would begin only on an approved effective date and signature by authorized representatives. This canary has no effective date and creates no term."),
    heading("4. CONFIDENTIALITY"),
    body("A real agreement would require each party to protect non-public business, technical, and financial information, subject to customary exclusions and permitted disclosures."),
    heading("5. INTELLECTUAL PROPERTY"),
    body("A real agreement would distinguish client-specific deliverables from the Service Provider’s pre-existing tools, frameworks, methodologies, know-how, and open-source components."),
    heading("6. WARRANTIES"),
    body("A real agreement would state professional-performance and conformity warranties and define a bounded correction period. No warranty is made by this canary draft."),
    heading("7. LIMITATION OF LIABILITY"),
    body("A real agreement would exclude indirect and consequential damages and cap aggregate liability, subject to negotiated exceptions and professional legal review."),
    heading("8. INDEMNIFICATION"),
    body("A real agreement would allocate third-party claim responsibilities, defense control, notice, and cooperation obligations after professional legal review."),
    heading("9. GENERAL PROVISIONS"),
    body("A real agreement would include independent-contractor, force-majeure, assignment, notices, entire-agreement, amendment, waiver, and severability provisions."),
    heading("10. GOVERNING LAW AND DISPUTE RESOLUTION"),
    body("A real agreement is intended to be governed by the laws of India, with good-faith negotiation followed by arbitration in Bengaluru, Karnataka, under the Arbitration and Conciliation Act, 1996, as amended. This clause remains a draft for legal review."),
    heading("11. SIGNATURES DISABLED"),
    body("No signature blocks are provided. Human legal and executive approval is required before a separate signable version may be created."),
    heading("APPENDIX A – SCOPE OF WORK"),
    body(`PROJECT: ${input.projectName}`, { run: { bold: true } }),
    body(input.projectSummary),
    body("DELIVERABLES", { run: { bold: true } }),
    ...list(input.deliverables),
    body("OUT OF SCOPE", { run: { bold: true } }),
    ...list(input.outOfScope),
    body(warning, { alignment: AlignmentType.CENTER, run: { bold: true, color: "B91C1C" } }),
  ];
  return new Document({
    creator: "Thoughtseed Temperance Engine",
    title: `System Canary Draft — ${input.projectName}`,
    description: warning,
    styles: {
      default: { document: { run: { font: "Times New Roman", size: 22 } } },
      paragraphStyles: [{
        id: "Heading1",
        name: "Heading 1",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { font: "Times New Roman", size: 24, bold: true },
        paragraph: { spacing: { before: 240, after: 140 }, outlineLevel: 0 },
      }],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "B91C1C", space: 1 } },
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: warning, font: "Times New Roman", size: 18, bold: true, color: "B91C1C" })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "Thoughtseed internal system canary · Page ", font: "Times New Roman", size: 18 }),
              new TextRun({ children: [PageNumber.CURRENT], font: "Times New Roman", size: 18 }),
            ],
          })],
        }),
      },
      children,
    }],
  });
}

export async function runBusinessCli(argv) {
  const args = parseArgs(argv);
  const rawText = await readStdin();
  let directive;
  try { directive = JSON.parse(rawText); } catch { fail("invalid_json", "stdin must contain one JSON directive"); }
  let policy;
  try { policy = JSON.parse(await readFile(args.policy, "utf8")); } catch { fail("policy_unreadable", "policy file is unavailable or invalid"); }
  const result = await renderServiceAgreement(directive, policy, args.outputDir, args.memberId);
  process.stdout.write(`${canonicalJson(result)}\n`);
}

function parseArgs(argv) {
  const allowed = new Set(["--policy", "--output-dir", "--member-id"]);
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag) || !value) fail("invalid_arguments", "expected --policy FILE --output-dir DIR --member-id ID");
    result[flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  for (const key of ["policy", "outputDir", "memberId"]) if (!result[key]) fail("invalid_arguments", `missing ${key}`);
  safeId(result.memberId, "memberId");
  return result;
}

function exactObject(value, path, required) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid_type", `${path} must be an object`);
  const allowed = new Set(required);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail("unknown_field", `unknown field ${path}.${key}`);
  for (const key of required) if (!(key in value)) fail("missing_field", `missing field ${path}.${key}`);
  return value;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") {
    if (typeof value === "number" && !Number.isSafeInteger(value)) fail("invalid_number", "canonical JSON accepts safe integers only");
    return typeof value === "string" ? value.normalize("NFC") : value;
  }
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key.normalize("NFC"), canonicalValue(value[key])]));
}

function stringList(value, path, min, max, itemMax) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail("invalid_field", `${path} length is invalid`);
  return value.map((item, index) => text(item, `${path}.${index}`, 1, itemMax));
}

function text(value, path, min, max) {
  if (typeof value !== "string") fail("invalid_field", `${path} must be text`);
  const normalized = value.trim().normalize("NFC");
  if (normalized.length < min || normalized.length > max || /[\u0000-\u001F\u007F]/.test(normalized)) fail("invalid_field", `${path} is invalid`);
  return normalized;
}

function equal(actual, expected, path) {
  if (actual !== expected) fail("contract_mismatch", `${path} does not match pinned contract`);
}

function safeId(value, path) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) fail("invalid_field", `${path} must be a safe identifier`);
}

function isoDate(value, path) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("invalid_field", `${path} must be canonical ISO-8601`);
}

function fail(code, message) {
  throw new BusinessContractError(code, message);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const result = Buffer.concat(chunks).toString("utf8");
  if (!result || result.length > 256_000) fail("invalid_input", "stdin payload size is invalid");
  return result;
}
