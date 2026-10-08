package com.batteryinventory.service;

import android.content.Context;
import android.util.AtomicFile;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Durable business envelope, independent of authentication credentials. */
final class BusinessDataStore {
    static final int MAX_BYTES = 16 * 1024 * 1024;
    private final File directory;
    private final AtomicFile file;

    BusinessDataStore(Context context, String scope) throws ServicePolicy.Failure {
        directory = context.getFilesDir();
        if (directory == null || !directory.isDirectory()) throw failure("Private business recovery storage is unavailable.", "BUSINESS_STORAGE");
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(scope.getBytes(StandardCharsets.UTF_8));
            StringBuilder name = new StringBuilder("battery-service-business-v1-");
            for (byte value : digest) name.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
            name.append(".json");
            file = new AtomicFile(new File(directory, name.toString()));
        } catch (Exception ignored) { throw failure("The business recovery scope could not be resolved.", "BUSINESS_STORAGE"); }
    }
    private static ServicePolicy.Failure failure(String message, String code) { return new ServicePolicy.Failure(message, code); }
    private boolean genuinelyMissing() {
        File base = file.getBaseFile();
        return directory.isDirectory() && directory.canRead() && directory.canExecute()
            && !base.exists() && !new File(base.getPath() + ".bak").exists() && !new File(base.getPath() + ".new").exists();
    }
    String load() throws ServicePolicy.Failure {
        try (FileInputStream input = file.openRead(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] chunk = new byte[16384]; int count;
            while ((count = input.read(chunk)) != -1) {
                if (count > MAX_BYTES - output.size()) throw failure("The saved business envelope exceeds 16 MiB. Its file was preserved; no partial data was loaded.", "BUSINESS_DATA_TOO_LARGE");
                output.write(chunk, 0, count);
            }
            try {
                return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(output.toByteArray())).toString();
            } catch (Exception ignored) { throw failure("The saved business envelope is not valid UTF-8. Its file was preserved.", "BUSINESS_DATA_CORRUPT"); }
        } catch (FileNotFoundException ignored) {
            if (genuinelyMissing()) return null;
            throw failure("Business recovery data could not be read. Existing files were preserved; do not replace pending work.", "BUSINESS_STORAGE");
        } catch (ServicePolicy.Failure failure) { throw failure; }
        catch (Exception ignored) { throw failure("Business recovery data could not be read. Existing files were preserved; do not replace pending work.", "BUSINESS_STORAGE"); }
    }
    void save(String data) throws ServicePolicy.Failure {
        if (data == null) throw failure("Provide the complete business envelope as a string.", "INVALID_BUSINESS_DATA");
        long length = 0;
        for (int index = 0; index < data.length(); index++) {
            char value = data.charAt(index);
            if (value <= 0x7f) length++;
            else if (value <= 0x7ff) length += 2;
            else if (Character.isHighSurrogate(value)) {
                if (index + 1 >= data.length() || !Character.isLowSurrogate(data.charAt(index + 1))) throw failure("Provide valid Unicode business data. Existing files were preserved.", "INVALID_BUSINESS_DATA");
                index++; length += 4;
            } else if (Character.isLowSurrogate(value)) throw failure("Provide valid Unicode business data. Existing files were preserved.", "INVALID_BUSINESS_DATA");
            else length += 3;
            if (length > MAX_BYTES) throw failure("The complete business envelope exceeds 16 MiB. Existing data was preserved.", "BUSINESS_DATA_TOO_LARGE");
        }
        byte[] bytes;
        try {
            ByteBuffer encoded = StandardCharsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).encode(CharBuffer.wrap(data));
            bytes = new byte[encoded.remaining()];
            encoded.get(bytes);
        } catch (CharacterCodingException ignored) { throw failure("Provide valid Unicode business data. Existing files were preserved.", "INVALID_BUSINESS_DATA"); }
        if (bytes.length > MAX_BYTES) throw failure("The complete business envelope exceeds 16 MiB. Existing data was preserved.", "BUSINESS_DATA_TOO_LARGE");
        FileOutputStream output = null;
        try {
            output = file.startWrite();
            output.write(bytes);
            output.flush();
            output.getFD().sync();
            file.finishWrite(output);
            output = null;
            // AtomicFile can report a failed rename through platform logging.
            // Read back the complete committed value before authorizing a send.
            if (!data.equals(load())) throw failure("The complete business envelope was not confirmed in durable storage. Keep pending work and retry saving it.", "BUSINESS_STORAGE");
        } catch (Exception ignored) {
            if (output != null) {
                try { file.failWrite(output); } catch (Exception rollbackFailure) { /* Keep existing files for explicit recovery. */ }
            }
            throw failure("Business recovery data was not confirmed saved. Existing files were not cleared; do not send a new mutation.", "BUSINESS_STORAGE");
        }
    }
}
