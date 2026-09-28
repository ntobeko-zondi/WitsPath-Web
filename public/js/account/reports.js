// My reports: every report the signed-in user filed (from the website or the
// Android app), newest first, with its status - same as the Android screen.
(function () {
  'use strict';

  const ISSUE_LABELS = {
    broken_lift: 'Broken lift',
    blocked_or_broken_ramp: 'Blocked or broken ramp',
    path_obstructed: 'Path obstructed',
    other: 'Other'
  };
  const status = document.getElementById('reportsStatus');
  const list = document.getElementById('reportsList');
  const signIn = document.getElementById('reportsSignIn');
  const auth = window.WitsPathAuth;
  const t = (key, fallback) => (window.WitsPathI18n ? window.WitsPathI18n.t(key, fallback) : fallback);

  function relativeDate(iso) {
    if (!iso) return '';
    const minutes = Math.round((Date.now() - new Date(iso)) / 60000);
    const format = new Intl.RelativeTimeFormat(window.WitsPathSettings?.uiLanguage() || 'en', { numeric: 'auto' });
    if (Math.abs(minutes) < 60) return format.format(-minutes, 'minute');
    if (Math.abs(minutes) < 60 * 24) return format.format(-Math.round(minutes / 60), 'hour');
    return format.format(-Math.round(minutes / (60 * 24)), 'day');
  }

  function render(reports) {
    status.textContent = reports.length ? '' : 'You haven’t reported any obstacles yet.';
    list.replaceChildren(
      ...reports.map((report) => {
        const li = document.createElement('li');
        const text = document.createElement('div');
        const title = document.createElement('strong');
        const issueType = ISSUE_LABELS[report.issueType] ? report.issueType : 'other';
        title.textContent = t(issueType, ISSUE_LABELS[issueType]);
        const meta = document.createElement('span');
        meta.className = 'companion-small';
        meta.textContent = [report.place, relativeDate(report.timestamp)].filter(Boolean).join(' · ');
        text.append(title, meta);
        const chip = document.createElement('span');
        chip.className = `companion-chip ${report.status === 'flagged' ? 'is-warn' : ''}`;
        chip.textContent =
          report.status === 'flagged' ? t('report_status_flagged', 'Flagged') : t('report_status_pending', 'Status pending');
        li.append(text, chip);
        return li;
      })
    );
  }

  async function load(user) {
    if (!user) {
      status.textContent = '';
      list.replaceChildren();
      signIn.hidden = false;
      return;
    }
    signIn.hidden = true;
    status.textContent = 'Loading…';
    try {
      const response = await auth.authorizedFetch('/api/reports/mine');
      if (!response.ok) throw new Error(String(response.status));
      render((await response.json()).reports);
    } catch {
      status.textContent = 'An error occurred while loading your reports. Please try again later.';
    }
  }

  auth.ready.then((enabled) => {
    if (!enabled) {
      status.textContent = 'Accounts are not set up on this site yet, so there are no reports to show.';
      return;
    }
    auth.onChange(load);
  });
})();
