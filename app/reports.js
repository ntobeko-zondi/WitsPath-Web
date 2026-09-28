const reportsList = document.getElementById('reportsList');
const reportsStatus = document.getElementById('reportsStatus');
const reportDialog = document.getElementById('reportDialog');
const reportForm = document.getElementById('reportForm');
const reportLocation = document.getElementById('reportLocation');
const reportRouteMode = document.getElementById('routeMode');
const reportModeLabels = {
  wheelchair: 'Wheelchair Accessible',
  'walking-aid': 'Walking Aid',
  visual: 'Visual Assistance',
  general: 'General Route',
  'low-vision': 'Visual Assistance',
  'no-preference': 'General Route'
};

function getReports() {
  try {
    const reports = JSON.parse(readStorage(STORAGE_KEYS.reports, '[]'));
    return Array.isArray(reports) ? reports : [];
  } catch {
    return [];
  }
}

function renderReports() {
  const reports = getReports();
  reportsList.replaceChildren();
  if (reports.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'reports-empty';
    empty.textContent = 'No reports yet.';
    reportsList.appendChild(empty);
    return;
  }

  reports.forEach((report) => {
    const details = document.createElement('details');
    details.className = 'report-entry';
    const summary = document.createElement('summary');
    const heading = document.createElement('span');
    heading.className = 'report-entry-title';
    heading.textContent = report.issueType;
    const timestamp = document.createElement('time');
    timestamp.dateTime = report.createdAt;
    timestamp.textContent = new Date(report.createdAt).toLocaleString();
    summary.append(heading, timestamp);

    const meta = document.createElement('p');
    meta.className = 'report-entry-meta';
    meta.textContent = `${report.location} · ${report.status}${report.destination ? ` · Route to ${report.destination}` : ''}`;
    const description = document.createElement('p');
    description.textContent = report.description;
    const route = document.createElement('p');
    route.className = 'report-entry-route';
    const routeSummary = [report.start && `Start: ${report.start}`, report.destination && `Destination: ${report.destination}`, report.routeMode && `Mode: ${report.routeMode}`].filter(Boolean).join(' · ');
    route.textContent = routeSummary;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'report-delete';
    remove.dataset.reportId = report.id;
    remove.textContent = 'Delete report';
    remove.setAttribute('aria-label', `Delete report: ${report.issueType} at ${report.location}`);
    details.append(summary, meta, description);
    if (routeSummary) details.appendChild(route);
    details.appendChild(remove);
    reportsList.appendChild(details);
  });
}

function openReportDialog() {
  reportDialog.showModal();
  document.getElementById('issueType').focus();
}

function closeReportDialog() {
  reportDialog.close();
  document.getElementById('openReport').focus();
}

async function loadCampusLocations() {
  try {
    const response = await fetch('data/wits-west-map.json');
    if (!response.ok) throw new Error('Could not load campus locations.');
    const graph = await response.json();
    const nodes = graph.nodes
      .filter((node) => node && node.label)
      .sort((left, right) => left.label.localeCompare(right.label));
    [reportLocation, document.getElementById('routeStart'), document.getElementById('routeDestination')].forEach((select) => {
      nodes.forEach((node) => {
        const option = document.createElement('option');
        option.value = node.label.trim();
        option.textContent = node.label.trim();
        select.appendChild(option);
      });
    });
    const params = new URLSearchParams(window.location.search);
    const requestedLocation = params.get('location');
    if (requestedLocation) reportLocation.value = requestedLocation;
  } catch {
    reportsStatus.textContent = 'Campus locations could not be loaded. You can still review existing reports.';
  }
}

function initializeRouteDetails() {
  const params = new URLSearchParams(window.location.search);
  document.getElementById('routeStart').value = params.get('start') || '';
  document.getElementById('routeDestination').value = params.get('destination') || '';
  reportRouteMode.value = reportModeLabels[params.get('mode')]
    ? (params.get('mode') === 'low-vision' ? 'visual' : params.get('mode') === 'no-preference' ? 'general' : params.get('mode'))
    : '';
  if (params.get('create') === '1') openReportDialog();
}

function createReportId() {
  return window.crypto?.randomUUID?.() || `report-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

document.body.dataset.theme = readStorage(STORAGE_KEYS.darkMode, 'false') === 'true' ? 'dark' : 'light';
document.body.dataset.contrast = readStorage(STORAGE_KEYS.highContrast, 'false') === 'true' ? 'true' : 'false';
document.body.dataset.textScale = readStorage(STORAGE_KEYS.textSize, 'default');

document.getElementById('openReport').addEventListener('click', openReportDialog);
document.getElementById('closeReport').addEventListener('click', closeReportDialog);
reportDialog.addEventListener('click', (event) => {
  if (event.target === reportDialog) closeReportDialog();
});
reportsList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-report-id]');
  if (!button) return;
  const remaining = getReports().filter((report) => report.id !== button.dataset.reportId);
  setStorage(STORAGE_KEYS.reports, JSON.stringify(remaining));
  renderReports();
  reportsStatus.textContent = 'Report deleted from this device.';
});
reportForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!reportForm.reportValidity()) return;
  const params = new URLSearchParams(window.location.search);
  const reports = getReports();
  reports.unshift({
    id: createReportId(),
    issueType: document.getElementById('issueType').value,
    location: reportLocation.value,
    description: document.getElementById('reportDescription').value.trim(),
    start: document.getElementById('routeStart').value.trim(),
    destination: document.getElementById('routeDestination').value.trim(),
    routeMode: reportModeLabels[reportRouteMode.value] || '',
    createdAt: new Date().toISOString(),
    status: 'Submitted'
  });
  setStorage(STORAGE_KEYS.reports, JSON.stringify(reports));
  reportForm.reset();
  reportDialog.close();
  document.getElementById('openReport').focus();
  reportsStatus.textContent = 'Report submitted and saved on this device.';
  renderReports();
});

renderReports();
loadCampusLocations().then(initializeRouteDetails);
