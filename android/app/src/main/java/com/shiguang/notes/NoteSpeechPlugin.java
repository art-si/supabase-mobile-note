package com.shiguang.notes;

import android.Manifest;
import android.media.MediaRecorder;
import android.media.AudioRecord;
import android.media.AudioFormat;
import android.util.Base64;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

@CapacitorPlugin(name = "NoteSpeech", permissions = @Permission(alias = "microphone", strings = Manifest.permission.RECORD_AUDIO))
public class NoteSpeechPlugin extends Plugin {
    private AudioRecord recorder;
    private Thread reader;
    private ByteArrayOutputStream audio;
    private volatile boolean capturing;
    private volatile boolean readFailed;
    private volatile PluginCall permissionPending;
    @PluginMethod public void start(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            permissionPending = call;
            requestPermissionForAlias("microphone", call, "permissionResult");
        } else begin(call);
    }
    @PermissionCallback private void permissionResult(PluginCall call) {
        if (permissionPending != call) return;
        permissionPending = null;
        if (getPermissionState("microphone") == PermissionState.GRANTED) begin(call);
        else call.reject("请允许使用麦克风后，再按住说话");
    }
    private synchronized void begin(PluginCall call) {
            if (recorder != null) { call.reject("正在录音，请稍候"); return; }
            try {
                int size = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
                if (size <= 0) throw new IllegalStateException();
                recorder = new AudioRecord(MediaRecorder.AudioSource.MIC, 16000,
                    AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(size, 6400));
                if (recorder.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException();
                audio = new ByteArrayOutputStream();
                AudioRecord source = recorder;
                ByteArrayOutputStream bytes = audio;
                readFailed = false; capturing = true;
                recorder.startRecording();
                reader = new Thread(() -> {
                    byte[] buffer = new byte[6400];
                    try {
                        while (capturing && bytes.size() < 2_080_000) {
                            int count = source.read(buffer, 0, Math.min(buffer.length, 2_080_000 - bytes.size()));
                            if (count <= 0) { if (capturing) readFailed = true; break; }
                            bytes.write(buffer, 0, count);
                        }
                    } catch (IllegalStateException error) { readFailed = true; }
                    finally {
                        capturing = false;
                        try { stopSource(source); } catch (IllegalStateException error) { readFailed = true; }
                    }
                }, "note-voice");
                reader.start(); call.resolve();
            } catch (Exception error) { clear(); call.reject("无法启动录音，请检查麦克风权限"); }
    }
    @PluginMethod public synchronized void stop(PluginCall call) {
            cancelPermission();
            if (recorder == null) { call.reject("请重新按住说话"); return; }
            try {
                finishRecording();
                if (readFailed || audio.size() < 6400) throw new IllegalStateException();
                JSObject result = new JSObject();
                byte[] pcm = audio.toByteArray();
                ByteBuffer wav = ByteBuffer.allocate(44 + pcm.length).order(ByteOrder.LITTLE_ENDIAN);
                wav.put(new byte[]{'R','I','F','F'}).putInt(36 + pcm.length).put(new byte[]{'W','A','V','E','f','m','t',' '});
                wav.putInt(16).putShort((short)1).putShort((short)1).putInt(16000).putInt(32000).putShort((short)2).putShort((short)16);
                wav.put(new byte[]{'d','a','t','a'}).putInt(pcm.length).put(pcm);
                result.put("data", Base64.encodeToString(wav.array(), Base64.NO_WRAP));
                result.put("mimeType", "audio/wav");
                clear(); call.resolve(result);
            } catch (Exception error) { clear(); call.reject("说话时间太短，请按住后再说一次"); }
    }
    @PluginMethod public synchronized void cancel(PluginCall call) {
        cancelPermission(); clear(); call.resolve();
    }
    private void cancelPermission() {
        if (permissionPending != null) { permissionPending.reject("授权后请重新按住说话"); permissionPending = null; }
    }
    private void finishRecording() throws InterruptedException {
        capturing = false;
        if (recorder != null) stopSource(recorder);
        if (reader != null) { reader.join(1500); if (reader.isAlive()) throw new IllegalStateException(); }
        reader = null;
    }
    private void stopSource(AudioRecord source) {
        synchronized (source) {
            if (source.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) source.stop();
        }
    }
    private synchronized void clear() {
        try { finishRecording(); }
        catch (InterruptedException error) { Thread.currentThread().interrupt(); }
        catch (IllegalStateException error) { readFailed = true; }
        if (recorder != null) { recorder.release(); recorder = null; }
        audio = null;
    }
    @Override protected void handleOnPause() { cancelPermission(); clear(); }
    @Override protected void handleOnDestroy() { cancelPermission(); clear(); }
}
