# Temperance headless shadow runtime

This is the deliberately non-executing EC2 subset of Temperance Engine. It validates one Hermes-shaped attempt envelope, enriches it with a versioned policy route, resolves logical skills and renderer policy, and emits a typed proof decision.

It does not contain backend adapters, hooks, desktop templates, voice, Pulse, schedulers, approval mutation, domain writes, or network clients.

## Canonical proof contract

`thoughtseed.canonical_json.nfc_utf8_sorted_keys_integer_numbers.v1` means:

1. Input must be JSON values only.
2. Object keys and string values are normalized to Unicode NFC.
3. Object keys are sorted by their normalized UTF-8 bytes; arrays retain order.
4. Numbers must be safe integers. Floating point, `NaN`, and infinity are rejected.
5. Canonical bytes are the UTF-8 encoding of compact `JSON.stringify` output.
6. Digests are lowercase SHA-256 with the `sha256:` prefix.

The decision digest covers the complete decision except the `proof` object. The input digest covers the validated envelope. This avoids self-referential hashing while binding all identity, context, approval-observation, route, skill, renderer, and guardrail fields.

## Frozen envelope

- Schema: `thoughtseed.hermes.temperance_shadow_attempt.v1`
- Policy: `thoughtseed.temperance.shadow_policy.v1`
- Decision: `thoughtseed.temperance.shadow_decision.v1`
- Unknown fields: rejected
- Approval: observed from external authority only; never granted here
- Lease/fence: identity is observed, but no fencing token is accepted or emitted

The golden fixture records the deployed Hermes release commit whose `runner.ts` and `native-execution.ts` attempt shape was inspected. Its IDs are synthetic; it contains no credentials or live fencing material.

## Gates

```bash
npm ci --ignore-scripts
npm test
npm run standalone:audit
npm run standalone:smoke
```

Node 22 is the pinned runtime on EC2. The package has no dependencies and no lifecycle scripts.
