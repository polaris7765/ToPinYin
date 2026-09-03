package com.pinyinapp.unity;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;

public final class PinyinFileProvider extends ContentProvider {
    private static final String AUTHORITY_SUFFIX = ".pinyinfileprovider";

    public static Uri getUriForFile(Context context, File file) throws IOException {
        File readableFile = requireReadableFile(context, file.getCanonicalFile());
        return new Uri.Builder()
            .scheme("content")
            .authority(context.getPackageName() + AUTHORITY_SUFFIX)
            .appendPath(readableFile.getAbsolutePath())
            .build();
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public String getType(Uri uri) {
        String extension = MimeTypeMap.getFileExtensionFromUrl(resolve(uri).getName());
        String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension.toLowerCase());
        return mime != null ? mime : "application/octet-stream";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection,
                        String[] selectionArgs, String sortOrder) {
        File file = resolve(uri);
        String[] columns = projection != null ? projection
            : new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE };
        MatrixCursor cursor = new MatrixCursor(columns, 1);
        MatrixCursor.RowBuilder row = cursor.newRow();
        for (String column : columns) {
            if (OpenableColumns.DISPLAY_NAME.equals(column)) row.add(file.getName());
            else if (OpenableColumns.SIZE.equals(column)) row.add(file.length());
            else row.add(null);
        }
        return cursor;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("Read-only provider");
        return ParcelFileDescriptor.open(resolve(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException("Read-only provider");
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("Read-only provider");
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("Read-only provider");
    }

    private File resolve(Uri uri) {
        try {
            return requireReadableFile(getContext(), new File(uri.getLastPathSegment()).getCanonicalFile());
        } catch (IOException exception) {
            throw new SecurityException("Invalid file URI", exception);
        }
    }

    private static File requireReadableFile(Context context, File file) throws IOException {
        if (context == null || !file.isFile()) throw new FileNotFoundException(file.getPath());
        if (isInside(file, context.getFilesDir())) return file;
        File externalDir = context.getExternalFilesDir(null);
        if (externalDir != null && isInside(file, externalDir)) return file;
        throw new SecurityException("File is outside the application directories");
    }

    private static boolean isInside(File file, File directory) throws IOException {
        String filePath = file.getCanonicalPath();
        String directoryPath = directory.getCanonicalPath() + File.separator;
        return filePath.startsWith(directoryPath);
    }
}