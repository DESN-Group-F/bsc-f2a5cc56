package com.batteryinventory.service;

import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.zip.CRC32;
import java.util.zip.Inflater;

/** Optional wire codec; the durable file still receives the original string. */
final class BusinessDataCodec {
    static final String GZIP_BASE64 = "gzip-base64-v1";
    private static final int MAX_BYTES = BusinessDataStore.MAX_BYTES;
    private static final int MAX_BASE64 = 4 * ((MAX_BYTES + 2) / 3);
    private static ServicePolicy.Failure invalid() {
        return new ServicePolicy.Failure("The business transfer is not complete valid gzip/base64 UTF-8. Existing files were preserved.", "INVALID_BUSINESS_DATA");
    }
    private static ServicePolicy.Failure oversized() {
        return new ServicePolicy.Failure("The complete business transfer exceeds 16 MiB. Existing files were preserved.", "BUSINESS_DATA_TOO_LARGE");
    }
    private static int u8(byte[] bytes, int offset) { return bytes[offset] & 255; }
    private static long u32(byte[] bytes, int offset) {
        return (long) u8(bytes, offset) | (long) u8(bytes, offset + 1) << 8 | (long) u8(bytes, offset + 2) << 16 | (long) u8(bytes, offset + 3) << 24;
    }
    private static int headerEnd(byte[] bytes) throws ServicePolicy.Failure {
        if (bytes.length < 18 || u8(bytes, 0) != 31 || u8(bytes, 1) != 139 || u8(bytes, 2) != 8 || (u8(bytes, 3) & 224) != 0) throw invalid();
        int flags = u8(bytes, 3), offset = 10, end = bytes.length - 8;
        if ((flags & 4) != 0) {
            if (offset + 2 > end) throw invalid();
            int length = u8(bytes, offset) | u8(bytes, offset + 1) << 8;
            offset += 2;
            if (length > end - offset) throw invalid();
            offset += length;
        }
        for (int flag : new int[] { 8, 16 }) {
            if ((flags & flag) != 0) {
                while (offset < end && bytes[offset] != 0) offset++;
                if (offset >= end) throw invalid();
                offset++;
            }
        }
        if ((flags & 2) != 0) {
            if (offset + 2 > end) throw invalid();
            CRC32 header = new CRC32(); header.update(bytes, 0, offset);
            if ((header.getValue() & 65535) != (u8(bytes, offset) | u8(bytes, offset + 1) << 8)) throw invalid();
            offset += 2;
        }
        if (offset >= end) throw invalid();
        return offset;
    }
    static String decode(String data, Object codec) throws ServicePolicy.Failure {
        if (data == null) throw invalid();
        if (codec == null) return data;
        if (!(codec instanceof String) || !GZIP_BASE64.equals(codec)) throw invalid();
        if (data.length() > MAX_BASE64) throw oversized();
        Inflater inflater = new Inflater(true);
        try {
            byte[] bytes = Base64.decode(data, Base64.NO_WRAP);
            if (bytes.length > MAX_BYTES) throw oversized();
            if (!Base64.encodeToString(bytes, Base64.NO_WRAP).equals(data)) throw invalid();
            int start = headerEnd(bytes);
            inflater.setInput(bytes, start, bytes.length - start);
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            CRC32 crc = new CRC32(); byte[] chunk = new byte[16384];
            while (!inflater.finished()) {
                int count = inflater.inflate(chunk);
                if (count > MAX_BYTES - output.size()) throw oversized();
                if (count == 0 && !inflater.finished()) throw invalid();
                output.write(chunk, 0, count); crc.update(chunk, 0, count);
            }
            int trailer = bytes.length - inflater.getRemaining();
            // Exactly one member: no ignored tail bytes or concatenated stream.
            if (trailer != bytes.length - 8 || u32(bytes, trailer) != crc.getValue() || u32(bytes, trailer + 4) != output.size()) throw invalid();
            return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(output.toByteArray())).toString();
        } catch (ServicePolicy.Failure failure) { throw failure; }
        catch (Exception ignored) { throw invalid(); }
        finally { inflater.end(); }
    }
}
