package org.potatoplayer;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;

import org.libsdl.app.SDLActivity;

/**
 * The app's only screen. Everything is done by SDL's own activity and by the
 * native program (libmain.so, started through its SDL_main); this class names
 * the libraries to load and, when the user asks for it, opens the system
 * screen that lets the app read the games folders on the shared storage.
 */
public class PlayerActivity extends SDLActivity {
    @Override
    protected String[] getLibraries() {
        return new String[] {"SDL2", "main"};
    }

    /**
     * Sends the user to the system screen that gives the app access to every
     * folder, or asks for the older storage permission where that screen does
     * not exist. Called by the native program when the user chooses the game
     * list's line for it; the app is never sent there on its own.
     */
    public void askForAllFiles() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            if (!Environment.isExternalStorageManager()) {
                try {
                    startActivity(new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                            Uri.parse("package:" + getPackageName())));
                } catch (RuntimeException e) {
                    startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
                }
            }
        } else if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] {Manifest.permission.WRITE_EXTERNAL_STORAGE}, 1);
        }
    }
}
