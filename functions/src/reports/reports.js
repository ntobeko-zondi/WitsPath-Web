'use strict';

const { indexGraph } = require('../routing/graphIndex');
const config = require('../config');

// Issue reports, shared with the Android app: reports/{reportId} with
// { userId, edgeId, issueType, timestamp } (Android ReportEntry). The website
// adds nodeId (for place-level reports), description and source.
//
// Flagging (promised by the Android app's report sheet, not implemented
// there): when 3 different signed-in people report the same edge within
// FLAG_WINDOW_DAYS, edges/{edgeId}.status becomes "flagged". The routing
// engine treats flagged edges as unusable, and the Android EdgeUpdateListener
// reacts to the change. Only the team can clear a flag (set status back to
// "ok" in Firestore).

// Same values as the Android report sheet (sheet_report_issue.xml).
const ISSUE_TYPES = ['broken_lift', 'blocked_or_broken_ramp', 'path_obstructed', 'other'];
const FLAG_THRESHOLD = 3;
const FLAG_WINDOW_DAYS = 30;

/**
 * @param target a node id or edge id from the campus graph
 * @returns {{ reportId, flagged, countsTowardFlag }} or { error, message }
 */
async function fileReport(store, { userId, target, issueType, description, source }, now = new Date()) {
  const index = indexGraph(await store.getGraph());
  const edge = index.edgeById(target);
  const node = edge ? null : index.node(target);
  if (!edge && !node) {
    return { error: 'unknown_place', message: 'Choose the path or place the problem is on.' };
  }
  const type = issueType === undefined || issueType === null ? 'other' : issueType;
  if (!ISSUE_TYPES.includes(type)) {
    return { error: 'invalid_input', message: `issueType must be one of ${ISSUE_TYPES.join(', ')}.` };
  }
  const text = typeof description === 'string' ? description.trim() : '';
  if (text.length > config.MAX_REPORT_DESCRIPTION_CHARS) {
    return { error: 'invalid_input', message: `Descriptions are limited to ${config.MAX_REPORT_DESCRIPTION_CHARS} characters.` };
  }

  const reportId = await store.addReport({
    userId: userId || null,
    edgeId: edge ? edge.edgeId : null,
    nodeId: node ? node.nodeId : null,
    issueType: type,
    description: text || null,
    source,
    timestamp: now
  });

  // Anonymous reports are kept for the team but can't count towards a flag:
  // they can't be tied to distinct people.
  const countsTowardFlag = Boolean(edge && userId);
  const flagged = countsTowardFlag ? await applyFlagging(store, edge.edgeId, now) : false;
  return { reportId, flagged, countsTowardFlag };
}

/**
 * Flag an edge once enough distinct signed-in people reported it recently.
 * Idempotent: safe to run from both the API and the Firestore trigger (which
 * covers reports written directly by the Android app).
 * @returns true if this call flagged the edge
 */
async function applyFlagging(store, edgeId, now = new Date()) {
  const edge = await store.getEdge(edgeId);
  // Never create edges: the Android app files reports against
  // "placeholder_edge_id", which isn't a real edge.
  if (!edge || String(edge.status || 'ok').toLowerCase() !== 'ok') return false;

  const since = new Date(now.getTime() - FLAG_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const reports = await store.listReportsForEdge(edgeId);
  const reporters = new Set(
    reports.filter((report) => report.userId && new Date(report.timestamp) >= since).map((report) => report.userId)
  );
  if (reporters.size < FLAG_THRESHOLD) return false;
  await store.setEdgeStatus(edgeId, 'flagged');
  return true;
}

/** "My reports": newest first, with the edge's current status and readable place names. */
async function listMyReports(store, userId) {
  const [reports, graph] = await Promise.all([store.listReportsByUser(userId), store.getGraph()]);
  const index = indexGraph(graph);
  const name = (nodeId) => (index.node(nodeId)?.label || nodeId || '').replace(/\s+/g, ' ').trim();

  return reports
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .map((report) => {
      const edge = report.edgeId ? index.edgeById(report.edgeId) : null;
      const place = edge ? `${name(edge.fromNodeId)} – ${name(edge.toNodeId)}` : report.nodeId ? name(report.nodeId) : null;
      return {
        reportId: report.id,
        issueType: ISSUE_TYPES.includes(report.issueType) ? report.issueType : 'other',
        place,
        // Same rule as the Android My Reports screen.
        status: edge && String(edge.status).toLowerCase() === 'flagged' ? 'flagged' : 'pending',
        timestamp: report.timestamp ? new Date(report.timestamp).toISOString() : null
      };
    });
}

module.exports = { fileReport, applyFlagging, listMyReports, ISSUE_TYPES, FLAG_THRESHOLD, FLAG_WINDOW_DAYS };
