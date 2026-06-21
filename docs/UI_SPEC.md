# UI Spec — Hexwall

The UI is glance-first. Healthy is quiet; problems advance. Colors come from
`FUNCTIONAL_SPEC §1`. Use CSS variables so a dark mode is trivial later.

---

## 1. Zoom ladder (levels of detail)

The interface is a **semantic zoom**, like a map: each level reveals more and hides what isn't
needed. Crucially, render count stays bounded — never draw thousands of hexagons at once.

| Level | Name | What renders |
|---|---|---|
| L1 | **Cluster wall** | A pill: "N healthy nodes folded" (clickable). Plus the non-folded **node boxes**, each with its border color (node health) and its **4 quartile hexagons**. Sorted worst-first. |
| L2 | **Node detail** | One node fills the view: its **real per-pod honeycomb** (all pods, true count) + resource bars (CPU / memory / disk / network, each colored by `FUNCTIONAL_SPEC §3`) + condition chips. |
| L3 | **Pod detail** | One pod: crash block (if any) at the top, then highlighted logs, then events. |

Navigation: click a node box (L1→L2); click a hexagon/pod in the honeycomb (L2→L3). A back
control returns up a level. (POC may implement this as routed views rather than literal
continuous zoom, as long as the L1/L2/L3 transitions and the expand-from-rollup idea read
clearly.)

---

## 2. Cluster wall (L1)

**Header:** cluster name; a one-line summary (`53 nodes · 5 need attention`); the **folded
healthy pill** on the right (green dot + "48 healthy nodes folded"). Clicking the pill toggles
a strip of small green tiles (the folded nodes) fetched from `/api/healthy`.

**Node box anatomy:**
- A card. **Border color = `nodeHealth`** (neutral 0.5px border when `ok`; 2px colored border
  when `warn`/`crit`).
- Header row: node name (monospace) + a small condition chip (e.g. `mem 88%`, `disk 96%`,
  `healthy`) colored by node health.
- Body: **4 hexagons** in a row (reads like a meter — "1 of 4", "3 of 4"). Colors from
  `QuartileBox.hexes`.
- Caption: `"{affectedPct}% of pods affected · tap to expand"` (or `"pods healthy"` when 0).

**The four meaningful combinations** (the design must make all four legible — include each in
the mock fixture and assert them in e2e):

| Border (node) | Hexes (pods) | Reading |
|---|---|---|
| neutral/green | some red | node fine, **app broken** → app team |
| amber/red | all green | node under pressure, **pods still up** → infra early warning |
| amber/red | some red | both the node and its apps are unhappy |
| neutral/green | some amber | minor app degradation (restarts climbing) |

**Live updates:** the wall subscribes to `/api/stream` (SSE) and re-renders on each snapshot.
New problems appear at the top (sort order). Folding obeys the §5.1 hysteresis so boxes don't
flicker.

---

## 3. Node detail (L2)

- Title: node name + instance type + pod count.
- **Real per-pod honeycomb:** every pod as a hexagon (true cardinality — 8 or 110), colored by
  pod `state`. This is the "expanded" form of the 4 rollup hexagons.
- **Resource panel:** horizontal bars for CPU (show both usage % and request % if they differ),
  Memory, Disk, each filled and colored by `FUNCTIONAL_SPEC §3`; a Network row (ready /
  packet-loss). Condition chips: `MemoryPressure`, `DiskPressure`, `Ready`, etc., colored.
- Clicking a pod hexagon opens L3.
- Optionally annotate a failing hexagon with its pod name + reason inline.

---

## 4. Pod detail (L3)

Order top-to-bottom (the crash answer must be first):
1. **Crash block** (only if `PodDetail.crash`): big, e.g. `payments-api · CrashLoopBackOff ·
   exit 137 (OOMKilled)`, followed by the **previous-container logs** (`crash.previousLogs`),
   highlighted. This is the thing that replaces `kubectl describe` + `kubectl logs --previous`.
2. **Live logs** (`PodDetail.logs`), highlighted, streaming from `/api/pod/.../logs` (SSE).
3. **Events** (`PodDetail.events`): type / reason / message / age.

**Log highlighting:** render each `LogLine.spans`; `crit` spans red, `warn` spans amber,
`plain` default. The point is that `panic`, `500`, `OOMKilled`, exit codes "jump on your face."

---

## 5. Interaction summary

- Click node box → node detail.
- Click pod hexagon → pod detail.
- Click folded-healthy pill → reveal/hide folded nodes.
- Back control → up one level.
- Everything is read-only: there are **no** edit/scale/delete/restart affordances anywhere in
  the UI. If a control would mutate the cluster, it must not exist.

---

## 6. Visual constraints

- Honeycomb hexagons: pointy-top, packed in offset rows. Overview rollup uses a row of 4;
  node-detail uses a packed blob.
- Comfortable density (from earlier analysis): a ~90–100px node box keeps short labels legible
  and colors distinct; that yields roughly 150–250 boxes per 1080p screen. The fold keeps the
  actual rendered count far below that in normal operation.
- Colorblind consideration: red vs amber is the classic confusion pair. In addition to color,
  the crash chip text and the caption carry the meaning in words, and lit-hexagon **count**
  encodes spread independently of hue.
