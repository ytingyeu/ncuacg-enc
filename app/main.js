// Modules to control application life and create native browser window
const { app, BrowserWindow, ipcMain, Menu, dialog } = require("electron");

//const child_spawn = require("child_process").spawn;

// Modules for ffmpeg control
const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const math = require("mathjs");

// since external exe file is called
// this variable must be set to true when developing
// while false for building
const g_devMode = true;

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;
let progressWindow;
let infoWindow;

function createWindow() {
    // Create the browser window.
    mainWindow = new BrowserWindow({ width: 800, height: 600 });

    // and load the index.html of the app.
    mainWindow.loadFile("./app/html/index.html");

    // create menu
    var menu = Menu.buildFromTemplate([
        {
            label: "Menu",
            submenu: [
                {
                    label: "About",
                    click() {
                        displayAppInfo();
                    }
                },
                {
                    label: "Exit",
                    click() {
                        app.quit();
                    }
                }
            ]
        }
    ]);
    Menu.setApplicationMenu(menu);

    // Open the DevTools.
    if (g_devMode) {
        mainWindow.webContents.openDevTools({ mode: "bottom" });
    }

    // Emitted when the window is closed.
    mainWindow.on("closed", function() {
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        if (progressWindow) {
            progressWindow.close();
        }

        if (infoWindow) {
            infoWindow.close();
        }

        mainWindow = null;
    });
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", () => {
    createWindow();
    handleSubmit();
});

// Quit when all windows are closed.
app.on("window-all-closed", function() {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== "darwin") {
        app.quit();
    }
});

app.on("activate", function() {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (mainWindow === null) {
        createWindow();
    }
});

/*
 * get the path of input/output from mainWindow
 * and execute ffmepg to encode
 */
function handleSubmit() {
    ipcMain.on("submit-form", (event, encInfo) => {

        
        let ffmpeg_bin;

        if (g_devMode) {
            ffmpeg_bin = path.join(__dirname, "..", "tools");
        } else {
            ffmpeg_bin = path.join(__dirname, "..", "..", "tools");
        }

        ffmpeg.setFfmpegPath(path.join(ffmpeg_bin, "ffmpeg.exe"));
        ffmpeg.setFfprobePath(path.join(ffmpeg_bin, "ffprobe.exe"));

        let newJob = ffmpeg(encInfo.src);

        newJob.ffprobe((err, data) => {
            if (err) {
                console.error(err);
            } else {
                let in_fps = math.ceil(eval(data.streams[0].r_frame_rate));
                
                newJob
                    .output(encInfo.des)
                    .outputOptions([
                        "-c:v libvpx-vp9",
                        "-b:v 0",
                        "-c:a libopus",
                        "-b:a 192k",
                        "-g " + in_fps * 10,
                        "-tile-columns 2",
                        "-tile-rows 0",
                        "-threads 4",
                        "-row-mt 1",
                        "-qmin 0",
                        "-qmax 63",
                        "-deadline good",
                        "-crf 18",
                        "-cpu-used " + encInfo.cpuUsed,
                        "-frame-parallel 1"
                    ]);                    

                if (encInfo.deinterlace && encInfo.denoise) {
                    newJob.addOutputOption("-vf yadif=0:-1:0,bm3d");
                } else if (encInfo.deinterlace) {
                    newJob.addOutputOption("-vf yadif=0:-1:0");
                } else if (encInfo.denoise) {
                    newJob.addOutputOption("-vf hqdn3d");
                }
            }
        });

        progressWindow = new BrowserWindow({ width: 400, height: 300 });
        progressWindow.setMenuBarVisibility(false);
        progressWindow.setMinimizable(false);
        progressWindow.setMaximizable(false);
        progressWindow.loadFile("./app/html/showProgress.html");

        progressWindow.webContents.on("did-finish-load", () => {
            if (g_devMode) {
                progressWindow.webContents.openDevTools({ mode: "bottom" });
            }

            newJob
                .on("error", err => {
                    //dialog.showErrorBox("Error", err.message);
                    console.log("Error: " + err.message);
                })
                .on("start", cmdLine => {
                    console.log("Spawned FFmpeg with command: " + cmdLine);
                })
                .on("codecData", codecData => {
                    progressWindow.webContents.send(
                        "update-duration",
                        codecData.duration
                    );
                })
                .on("progress", progress => {
                    console.log(progress);
                    if (progressWindow != null) {
                        progressWindow.webContents.send(
                            "update-progress",
                            progress.timemark
                        );
                    }
                })
                .on('end', () => {
                    if (progressWindow) {
                        progressWindow.close();
                    }
                    mainWindow.webContents.send('enc-term');
                })
                .run();

            /* event showProgress window closed handler */
            progressWindow.on("closed", function() {
                interruptEnc(newJob);
                progressWindow = null;
            });

            /* event showProgress window btn-cancel clicked handler */
            ipcMain.on("enc-cancel", function() {
                interruptEnc(newJob);
            });
        });
    });
}

/* interrupt encoding process */
function interruptEnc(ffmpegProc) {

    if (ffmpegProc != null) {
        ffmpegProc.kill("SIGTERM");
    }

    progressWindow = null;
    mainWindow.webContents.send("enc-term");
}

// development info
function displayAppInfo() {
    infoWindow = new BrowserWindow({ width: 350, height: 200 });
    infoWindow.setMenuBarVisibility(false);
    infoWindow.setMinimizable(false);
    infoWindow.setMaximizable(false);
    infoWindow.loadFile("./app/html/info.html");

    if (g_devMode) {
        infoWindow.webContents.openDevTools({ mode: "bottom" });
    }

    infoWindow.webContents.on("did-finish-load", () => {
        infoWindow.webContents.send("app-version", app.getVersion());
    });

    infoWindow.on("closed", function() {
        infoWindow = null;
    });
}
