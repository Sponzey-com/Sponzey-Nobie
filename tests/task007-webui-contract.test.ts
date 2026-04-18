import { describe, expect, it } from "vitest"
import type { RetrievalTimeline } from "../packages/webui/src/api/client.ts"

describe("task007 WebUI retrieval timeline contract", () => {
  it("keeps the run retrieval timeline response shape stable for the Run monitor panel", () => {
    const snapshot = {
      events: [{
        id: "evt-1",
        at: 1_000,
        kind: "verdict",
        eventType: "web_retrieval.verdict.completed",
        component: "web_retrieval",
        severity: "info",
        summary: "verdict accepted",
        detail: { verdict: { acceptedValue: "24102" } },
        source: { method: "fast_text_search", toolName: "web_search", url: null, domain: "google.com" },
        verdict: { canAnswer: true, acceptedValue: "24102", sufficiency: "sufficient_approximate", rejectionReason: null, conflicts: [] },
        diagnosticRef: { controlEventId: "evt-1", eventType: "web_retrieval.verdict.completed", component: "web_retrieval" },
      }],
      summary: {
        total: 1,
        sessionEvents: 0,
        attempts: 0,
        sources: 1,
        candidates: 0,
        verdicts: 1,
        plannerActions: 0,
        deliveryEvents: 0,
        dedupeSuppressed: 0,
        stops: 0,
        conflicts: 0,
        finalDeliveryStatus: null,
        stopReason: null,
        severityCounts: { debug: 0, info: 1, warning: 0, error: 0 },
      },
    } satisfies RetrievalTimeline

    expect(snapshot).toMatchInlineSnapshot(`
      {
        "events": [
          {
            "at": 1000,
            "component": "web_retrieval",
            "detail": {
              "verdict": {
                "acceptedValue": "24102",
              },
            },
            "diagnosticRef": {
              "component": "web_retrieval",
              "controlEventId": "evt-1",
              "eventType": "web_retrieval.verdict.completed",
            },
            "eventType": "web_retrieval.verdict.completed",
            "id": "evt-1",
            "kind": "verdict",
            "severity": "info",
            "source": {
              "domain": "google.com",
              "method": "fast_text_search",
              "toolName": "web_search",
              "url": null,
            },
            "summary": "verdict accepted",
            "verdict": {
              "acceptedValue": "24102",
              "canAnswer": true,
              "conflicts": [],
              "rejectionReason": null,
              "sufficiency": "sufficient_approximate",
            },
          },
        ],
        "summary": {
          "attempts": 0,
          "candidates": 0,
          "conflicts": 0,
          "dedupeSuppressed": 0,
          "deliveryEvents": 0,
          "finalDeliveryStatus": null,
          "plannerActions": 0,
          "sessionEvents": 0,
          "severityCounts": {
            "debug": 0,
            "error": 0,
            "info": 1,
            "warning": 0,
          },
          "sources": 1,
          "stopReason": null,
          "stops": 0,
          "total": 1,
          "verdicts": 1,
        },
      }
    `)
  })
})
