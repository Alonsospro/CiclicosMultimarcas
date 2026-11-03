// Estimated daily Firestore consumption shared between instances through the control document.
// It only informs: reaching a quota never pauses or degrades the app.
// Firestore free quotas reset at midnight Pacific time, so the counter uses that same day.
const DEFAULT_READ_QUOTA = 50000;
const DEFAULT_WRITE_QUOTA = 20000;
const REPORT_INTERVAL_MS = 15 * 60000;
const REPORT_MIN_INTERVAL_MS = 60000;
const REPORT_PENDING_OPERATIONS = 2000;
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
const positive = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};
const count = value => Math.max(0, Number(value) || 0);

class FirestoreUsage {
  constructor({ readQuota, writeQuota, warnRatio = 0.7, criticalRatio = 0.9, now = () => Date.now(), log = console } = {}) {
    this.readQuota = positive(readQuota, DEFAULT_READ_QUOTA);
    this.writeQuota = positive(writeQuota, DEFAULT_WRITE_QUOTA);
    this.warnRatio = warnRatio;
    this.criticalRatio = criticalRatio;
    this.now = now;
    this.log = log;
    this.day = null;
    this.lastReportAt = now();
    this.roll();
  }

  currentDay() { return dayFormat.format(new Date(this.now())); }

  roll() {
    const day = this.currentDay();
    if (day === this.day) return;
    this.day = day;
    this.shared = { reads: 0, writes: 0 };
    this.pending = { reads: 0, writes: 0 };
    this.loggedLevel = 'normal';
  }

  addReads(amount = 1) { this.roll(); this.pending.reads += count(amount); }
  addWrites(amount = 1) { this.roll(); this.pending.writes += count(amount); }

  // Learn what every instance has already reported from the control document.
  absorb(data) {
    this.roll();
    if (data?.usageDay !== this.day) return;
    this.shared.reads = Math.max(this.shared.reads, count(data.usageReads));
    this.shared.writes = Math.max(this.shared.writes, count(data.usageWrites));
  }

  unreported() { this.roll(); return { ...this.pending }; }

  fieldsFor(data, delta) {
    this.roll();
    const sameDay = data?.usageDay === this.day;
    return {
      usageDay: this.day,
      usageReads: (sameDay ? count(data.usageReads) : 0) + count(delta?.reads),
      usageWrites: (sameDay ? count(data.usageWrites) : 0) + count(delta?.writes)
    };
  }

  markReported(delta, fields) {
    this.roll();
    this.pending.reads = Math.max(0, this.pending.reads - count(delta?.reads));
    this.pending.writes = Math.max(0, this.pending.writes - count(delta?.writes));
    this.absorb(fields);
    this.lastReportAt = this.now();
  }

  shouldReport() {
    this.roll();
    const operations = this.pending.reads + this.pending.writes;
    if (!operations) return false;
    const elapsed = this.now() - this.lastReportAt;
    return elapsed >= REPORT_INTERVAL_MS || (operations >= REPORT_PENDING_OPERATIONS && elapsed >= REPORT_MIN_INTERVAL_MS);
  }

  noteReportAttempt() { this.lastReportAt = this.now(); }

  totals() {
    this.roll();
    return { reads: this.shared.reads + this.pending.reads, writes: this.shared.writes + this.pending.writes };
  }

  level() {
    const totals = this.totals();
    const ratio = Math.max(totals.reads / this.readQuota, totals.writes / this.writeQuota);
    const level = ratio >= this.criticalRatio ? 'critical' : ratio >= this.warnRatio ? 'warning' : 'normal';
    const rank = { normal: 0, warning: 1, critical: 2 };
    if (rank[level] > rank[this.loggedLevel]) {
      this.loggedLevel = level;
      this.log.warn?.(`[firestoreUsage] Consumo diario ${Math.round(ratio * 100)}% (${totals.reads} lecturas, ${totals.writes} escrituras): nivel ${level}.`);
    }
    return level;
  }

  snapshot() {
    const totals = this.totals();
    return {
      day: this.day,
      ...totals,
      readQuota: this.readQuota,
      writeQuota: this.writeQuota,
      readPercent: Math.round(totals.reads / this.readQuota * 1000) / 10,
      writePercent: Math.round(totals.writes / this.writeQuota * 1000) / 10,
      level: this.level(),
      estimated: true
    };
  }
}

module.exports = FirestoreUsage;
