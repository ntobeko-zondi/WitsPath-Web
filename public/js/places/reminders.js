// Next-class reminder, like the Android app's Smart Reminders: leave time =
// class start - estimated travel time - 5 minutes, using the shared routing
// engine's estimate. Stored on this device only.
//
// Browsers can only remind you while a WitsPath tab is open (the Android app
// can alarm in the background). The page says so.
(function () {
  'use strict';

  const BUFFER_MINUTES = 5; // Android ReminderManager: 5 min buffer
  const settings = window.WitsPathSettings;
  let timer = null;

  function todayAt(time) {
    const [hours, minutes] = time.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
  }

  function formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  /**
   * Work out the leave time for a class and save the reminder.
   * @returns the saved reminder, or { error }
   */
  async function setReminder({ fromNodeId, fromName, toNodeId, toName, time }) {
    const response = await fetch('/api/route', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fromNodeId,
        toNodeId,
        accessible: settings.get('stepFreeOnly'),
        speedMultiplier: settings.get('walkingSpeed')
      })
    }).catch(() => null);
    if (!response) return { error: "Can't reach WitsPath to estimate the travel time." };
    const card = await response.json();
    if (!response.ok || !card.travelTime) {
      return { error: "Couldn't confirm a route between those places, so no reminder was set." };
    }

    const start = todayAt(time);
    const leaveAt = new Date(start.getTime() - (card.travelTime.minutes + BUFFER_MINUTES) * 60000);
    const reminder = {
      fromNodeId,
      fromName,
      nodeId: toNodeId,
      name: toName,
      time,
      date: start.toDateString(),
      travelMinutes: card.travelTime.minutes,
      leaveAt: leaveAt.toISOString()
    };
    settings.set('nextClass', reminder);
    schedule();
    return reminder;
  }

  function clearReminder() {
    settings.set('nextClass', null);
    clearTimeout(timer);
  }

  /** A sentence describing the reminder, or null if there's none for today. */
  function describe(reminder = settings.get('nextClass')) {
    if (!reminder || reminder.date !== new Date().toDateString()) return null;
    const leaveAt = new Date(reminder.leaveAt);
    const past = leaveAt <= new Date();
    return (
      `Next class: ${reminder.name} at ${formatTime(todayAt(reminder.time))}. ` +
      (past ? 'It’s time to leave now' : `Leave by ${formatTime(leaveAt)}`) +
      ` (about ${reminder.travelMinutes} ${reminder.travelMinutes === 1 ? 'minute' : 'minutes'} from ${reminder.fromName}, estimate, plus ${BUFFER_MINUTES} minutes spare).`
    );
  }

  function remind(reminder) {
    const text = `Time to leave for ${reminder.name} (class at ${formatTime(todayAt(reminder.time))}).`;
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('WitsPath', { body: text, tag: 'witspath-next-class' });
      } catch {
        // Some browsers only allow notifications from a service worker.
      }
    }
    const banner = document.getElementById('reminderBanner');
    if (banner) {
      banner.textContent = text;
      banner.hidden = false;
    }
  }

  function schedule() {
    clearTimeout(timer);
    const reminder = settings.get('nextClass');
    if (!reminder || reminder.date !== new Date().toDateString()) return;
    const wait = new Date(reminder.leaveAt) - new Date();
    if (wait > 0 && wait < 24 * 60 * 60 * 1000) timer = setTimeout(() => remind(reminder), wait);
  }

  async function askForNotifications() {
    if (!('Notification' in window) || Notification.permission !== 'default') return;
    try {
      await Notification.requestPermission();
    } catch {
      // Ignored: the in-page banner still works.
    }
  }

  window.WitsPathReminders = { setReminder, clearReminder, describe, schedule, askForNotifications, BUFFER_MINUTES };
  schedule();
})();
