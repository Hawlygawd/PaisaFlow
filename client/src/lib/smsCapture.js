// Bank-SMS auto-capture for the Android app (the free, offline alternative to paid
// bank APIs). Indian banks send an SMS for every UPI/GPay/PhonePe/Paytm/card/netbanking
// debit & credit. A tiny native plugin (SmsWatcherPlugin.java) receives those SMS and
// forwards them here; we parse the amount/type/account and log the transaction
// automatically — fully offline, no API keys, works with every bank & payment app.

import { Capacitor, registerPlugin } from '@capacitor/core';
import { api, isLocal } from './api.js';
import * as local from './localBackend.js';

const SmsWatcher = registerPlugin('SmsWatcher');

const ENABLED_KEY = 'pf_autosms';
export const autoSmsEnabled = () => localStorage.getItem(ENABLED_KEY) === '1';
export const setAutoSmsEnabled = (on) => {
  if (on) localStorage.setItem(ENABLED_KEY, '1');
  else localStorage.removeItem(ENABLED_KEY);
};

let started = false;
let onCaptured = null;

// ---------------- SMS parsing ----------------
const OTP_RE = /\b(otp|one[\s-]?time\s+password|password\s+is|cvv)\b/i;
const FAILED_RE = /\b(failed|declined|rejected|unable to process|not successful|has been cancelled)\b/i;
const PROMO_RE = /\b(unsubscribe|click here|log\s?on to|download the app|apply now|kyc.?update|verify your (?:account|kyc)|lottery|congratulations.{0,20}you\s+have\s+won)\b/i;
const AMOUNT_RE = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i;
const CREDIT_RE = /\b(credited|deposited|received(?:\s+in)?|refund(?:ed)?|cashback|interest\s+credited|salary)\b/i;
const DEBIT_RE = /\b(debited|spent|paid|deducted|withdrawn|withdrawal|purchase|charged|used\s+(?:your\s+)?(?:card|account))\b/i;
const ACCT_RES = [
  /(?:a\/?c|acct|account)\s*(?:no\.?|number)?\s*[^\d]{0,14}([Xx*\d]*\d{4})\b/,
  /\b(?:xx|x{2,}|\*{2,})(\d{4})\b/i,
  /\b(?:card|credit\s+card)\s*(?:no\.?)?\s*[^\d]{0,10}([Xx*\d]*\d{4})\b/
];
const MERCHANT_RE = /\b(?:at|to|towards|on|for|by|in\s+favour\s+of)\s+([A-Za-z0-9][A-Za-z0-9 .&@/-]{2,28}?)(?=\s+(?:on|dated|dt|via|using|not|avbl|bal|\.)|[,.;]|$)/i;

export function parseBankSms(sender, body) {
  const text = String(body || '').replace(/\s+/g, ' ').trim();
  if (!text || OTP_RE.test(text) || FAILED_RE.test(text) || PROMO_RE.test(text)) return null;

  const amtMatch = text.match(AMOUNT_RE);
  if (!amtMatch) return null;
  const amount = Math.round(parseFloat(amtMatch[1].replace(/,/g, '')) * 100);
  if (!amount || amount <= 0) return null;

  const creditAt = text.search(CREDIT_RE);
  const debitAt = text.search(DEBIT_RE);
  let type = null;
  if (creditAt !== -1 && (debitAt === -1 || creditAt < debitAt)) type = 'income';
  else if (debitAt !== -1) type = 'expense';
  else return null;

  let last4 = null;
  for (const re of ACCT_RES) {
    const m = text.match(re);
    if (m) {
      const digits = (m[1].match(/\d{4}$/) || [])[0];
      if (digits) { last4 = digits; break; }
    }
  }

  let note = '';
  const merchant = text.match(MERCHANT_RE);
  if (merchant) note = merchant[1].trim().replace(/\s+/g, ' ');
  if (!note) note = text.slice(0, 60) + (text.length > 60 ? '…' : '');

  return { type, amount, last4, note: String(note).slice(0, 120), sender: String(sender || '') };
}

// Choose an income category for auto-captured credits
function guessIncomeCategory(text) {
  if (/\b(salary|payroll|sal\s*(?:cr)?\b)/i.test(text)) return local.findCategoryByName('Salary', 'income');
  if (/\b(cashback|interest)\b/i.test(text)) return local.findCategoryByName('Interest & Cashback', 'income');
  if (/\b(refund)\b/i.test(text)) return local.findCategoryByName('Other Income', 'income');
  return null; // Uncategorized
}

async function handleSms(sms) {
  if (!autoSmsEnabled()) return;
  const key = `${sms.sender}|${sms.body}|${sms.timestamp}`;
  if (local.seenSms(String(hash(key)))) return;
  local.rememberSms(String(hash(key)));

  const parsed = parseBankSms(sms.sender, sms.body);
  if (!parsed) return; // not a transaction SMS (OTP / promo / failed / unrecognised)

  const account = local.matchAccountByLast4(parsed.last4);
  const category = parsed.type === 'income' ? guessIncomeCategory(sms.body) : null;

  try {
    const { transaction } = await api.post('/transactions', {
      type: parsed.type,
      amount: parsed.amount / 100,
      date: new Date(sms.timestamp || Date.now()).toISOString().slice(0, 10),
      accountId: account ? account.id : null,
      categoryId: category ? category.id : null,
      note: parsed.note,
      source: 'sms'
    });
    if (onCaptured && transaction) {
      onCaptured({
        type: parsed.type,
        amount: parsed.amount,
        account: account ? account.name : null,
        id: transaction.id
      });
    }
  } catch { /* ignore — never disturb the user for background capture */ }
}

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

// ---------------- native bridge ----------------
export async function smsPermissions() {
  if (!Capacitor.isNativePlatform()) return { sms: 'unsupported' };
  try { return await SmsWatcher.checkPermissions(); } catch { return { sms: 'unsupported' }; }
}

export async function requestSmsPermissions() {
  if (!Capacitor.isNativePlatform()) return { sms: 'unsupported' };
  try { return await SmsWatcher.requestPermissions(); } catch { return { sms: 'unsupported' }; }
}

export async function startSmsCapture(callback) {
  onCaptured = callback || onCaptured;
  if (!isLocal() || !Capacitor.isNativePlatform() || !autoSmsEnabled()) return;
  if (started) return;
  started = true;
  try {
    await SmsWatcher.addListener('sms', handleSms);
    await SmsWatcher.start();
  } catch (e) {
    started = false;
    console.warn('SMS capture unavailable:', e);
  }
}

export function stopSmsCapture() {
  if (!started) return;
  started = false;
  try { SmsWatcher.removeListener('sms', handleSms); } catch { /* ignore */ }
}
