package com.paisaflow.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.telephony.SmsMessage;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * PaisaFlow auto-capture: listens for incoming bank transaction SMS (debit/credit
 * notifications) while the app is running and forwards them to JavaScript, where
 * they are parsed and logged as transactions. Nothing is uploaded anywhere —
 * the SMS content stays on the device, exactly like the rest of PaisaFlow data.
 */
@CapacitorPlugin(
    name = "SmsWatcher",
    permissions = {
        @Permission(
            alias = "sms",
            strings = {
                android.Manifest.permission.READ_SMS,
                android.Manifest.permission.RECEIVE_SMS
            }
        )
    }
)
public class SmsWatcherPlugin extends Plugin {

    private static final String SMS_EVENT = "sms";
    private BroadcastReceiver receiver = null;

    @Override
    public void load() {
        // Start listening as soon as the webview loads (permission is checked
        // before delivering events — Android only broadcasts SMS_RECEIVED to
        // apps holding RECEIVE_SMS anyway).
        startReceiver();
    }

    @Override
    protected void handleOnDestroy() {
        stopReceiver();
    }

    @PluginMethod
    public void checkPermissions(PluginCall call) {
        JSObject result = new JSObject();
        result.put("sms", getPermissionState("sms").toString());
        call.resolve(result);
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            requestPermissionForAlias("sms", call, "smsPermissionCallback");
        } else {
            checkPermissions(call);
        }
    }

    @PermissionCallback
    private void smsPermissionCallback(PluginCall call) {
        JSObject result = new JSObject();
        result.put("sms", getPermissionState("sms").toString());
        call.resolve(result);
    }

    @PluginMethod
    public void start(PluginCall call) {
        startReceiver();
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopReceiver();
        call.resolve();
    }

    private synchronized void startReceiver() {
        if (receiver != null) return;
        receiver = new SmsReceiver();
        IntentFilter filter = new IntentFilter("android.provider.Telephony.SMS_RECEIVED");
        filter.setPriority(IntentFilter.SYSTEM_HIGH_PRIORITY - 1);
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= 33) {
            ctx.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            ctx.registerReceiver(receiver, filter);
        }
    }

    private synchronized void stopReceiver() {
        if (receiver == null) return;
        try {
            getContext().unregisterReceiver(receiver);
        } catch (Exception ignored) {
        }
        receiver = null;
    }

    private class SmsReceiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent == null || !"android.provider.Telephony.SMS_RECEIVED".equals(intent.getAction())) return;
            Object[] pdus;
            try {
                pdus = (Object[]) intent.getExtras().get("pdus");
            } catch (Exception e) {
                return;
            }
            if (pdus == null || pdus.length == 0) return;

            String format = intent.getExtras() != null ? intent.getExtras().getString("format") : null;
            StringBuilder body = new StringBuilder();
            String sender = "";
            for (Object pdu : pdus) {
                try {
                    SmsMessage msg = format != null
                        ? SmsMessage.createFromPdu((byte[]) pdu, format)
                        : SmsMessage.createFromPdu((byte[]) pdu);
                    if (msg == null) continue;
                    sender = msg.getOriginatingAddress() != null ? msg.getOriginatingAddress() : sender;
                    String part = msg.getMessageBody();
                    if (part != null) body.append(part);
                } catch (Exception ignored) {
                }
            }
            if (body.length() == 0 || sender.isEmpty()) return;

            JSObject data = new JSObject();
            data.put("sender", sender);
            data.put("body", body.toString());
            data.put("timestamp", System.currentTimeMillis());
            notifyListeners(SMS_EVENT, data);
        }
    }
}
