#include <obs-module.h>
#include <obs-frontend-api.h>
#include <util/bmem.h>

#include <QApplication>
#include <QCheckBox>
#include <QClipboard>
#include <QDateTime>
#include <QFile>
#include <QFileDialog>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLabel>
#include <QLineEdit>
#include <QMetaObject>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QPointer>
#include <QPushButton>
#include <QQueue>
#include <QRegularExpression>
#include <QTextEdit>
#include <QUrl>
#include <QUuid>
#include <QVBoxLayout>

#include <functional>
#include <optional>
#include <utility>

OBS_DECLARE_MODULE()
MODULE_EXPORT const char *obs_module_description(void)
{
    return "Upload completed recordings and replay clips to your Clipstage workspace.";
}
MODULE_EXPORT const char *obs_module_name(void) { return "Clipstage"; }

namespace {
constexpr auto DockId = "clipstage-dock";
constexpr qint64 MaxBytes = 2LL * 1024 * 1024 * 1024;
constexpr int MaxQueuedJobs = 20;

struct Connection {
    QString apiUrl;
    QString workspaceId;
    QString token;
    bool ready() const { return !apiUrl.isEmpty() && !workspaceId.isEmpty() && !token.isEmpty(); }
};
struct Job {
    QString path;
    QString title;
    QString brief;
    QString mimeType;
    QString clientId;
    QString clipId;
    qint64 size = 0;
    qint64 modified = 0;
    Connection connection;
};

bool safeTransport(const QUrl &url)
{
    const auto host = url.host().toLower();
    return url.isValid() && url.userInfo().isEmpty() &&
           (url.scheme() == "https" || (url.scheme() == "http" &&
            (host == "localhost" || host == "127.0.0.1" || host == "::1")));
}
QString mimeFor(const QString &suffix)
{
    if (suffix == "mp4") return "video/mp4";
    if (suffix == "mov") return "video/quicktime";
    if (suffix == "webm") return "video/webm";
    if (suffix == "mkv") return "video/x-matroska";
    return {};
}

class ClipstageDock final : public QWidget {
public:
    explicit ClipstageDock(QWidget *parent = nullptr) : QWidget(parent), network(this)
    {
        auto *layout = new QVBoxLayout(this);
        auto *heading = new QLabel("<b>Clipstage</b> · Capture. Hand off. Keep streaming.");
        heading->setWordWrap(true);
        layout->addWidget(heading);
        connectionLabel = new QLabel("Not paired. Create a credential in Clipstage → OBS integration.");
        connectionLabel->setWordWrap(true);
        layout->addWidget(connectionLabel);
        auto *paste = new QPushButton("Paste connection settings");
        layout->addWidget(paste);
        connect(paste, &QPushButton::clicked, this, [this] { pair(); });

        layout->addWidget(new QLabel("Clip title (optional)"));
        title = new QLineEdit;
        title->setPlaceholderText("The moment chat won't stop talking about");
        title->setMaxLength(120);
        layout->addWidget(title);
        layout->addWidget(new QLabel("Brief for your editor"));
        brief = new QTextEdit;
        brief->setAcceptRichText(false);
        brief->setPlaceholderText("Where's the hook? What should the editor keep?");
        brief->setMaximumHeight(110);
        layout->addWidget(brief);
        autoUpload = new QCheckBox("Auto-upload completed recordings and saved replays");
        autoUpload->setChecked(true);
        layout->addWidget(autoUpload);

        auto *notice = new QLabel("Uses OBS's recording output, not a separate recorder. Use the replay buffer if you also keep a full-stream recording. Recording splits are not watched.");
        notice->setWordWrap(true);
        layout->addWidget(notice);
        record = new QPushButton;
        layout->addWidget(record);
        connect(record, &QPushButton::clicked, this, [this] {
            if (obs_frontend_recording_active()) obs_frontend_recording_stop();
            else obs_frontend_recording_start();
            record->setEnabled(false); // Re-enabled by OBS's started/stopped event.
        });
        replay = new QPushButton("Save replay clip");
        layout->addWidget(replay);
        connect(replay, &QPushButton::clicked, this, [] { obs_frontend_replay_buffer_save(); });
        auto *existing = new QPushButton("Upload an existing clip…");
        layout->addWidget(existing);
        connect(existing, &QPushButton::clicked, this, [this] {
            const auto path = QFileDialog::getOpenFileName(this, "Upload a source recording", {}, "Video files (*.mp4 *.mov *.webm *.mkv)");
            if (!path.isEmpty()) enqueue(path);
        });
        status = new QLabel("Use H.264/AAC MP4 for browser playback. Your originals are never deleted.");
        status->setWordWrap(true);
        status->setTextFormat(Qt::PlainText);
        layout->addWidget(status);
        queueLabel = new QLabel;
        layout->addWidget(queueLabel);
        retry = new QPushButton("Retry failed upload");
        discard = new QPushButton("Skip failed upload (keep local file)");
        layout->addWidget(retry);
        layout->addWidget(discard);
        connect(retry, &QPushButton::clicked, this, [this] {
            if (active && failed) { failed = false; updateControls(); initiate(); }
        });
        connect(discard, &QPushButton::clicked, this, [this] {
            if (active && failed) { active.reset(); failed = false; startNext(); }
        });
        layout->addStretch();
        updateControls();
    }

    void frontendEvent(enum obs_frontend_event event)
    {
        if (event == OBS_FRONTEND_EVENT_RECORDING_STOPPED || event == OBS_FRONTEND_EVENT_REPLAY_BUFFER_SAVED) {
            if (autoUpload->isChecked()) {
                char *last = event == OBS_FRONTEND_EVENT_RECORDING_STOPPED
                    ? obs_frontend_get_last_recording() : obs_frontend_get_last_replay();
                if (last && *last) enqueue(QString::fromUtf8(last));
                bfree(last);
            }
        }
        updateControls();
    }

private:
    QNetworkAccessManager network;
    Connection connection;
    QQueue<Job> jobs;
    std::optional<Job> active;
    bool failed = false;
    QLineEdit *title = nullptr;
    QTextEdit *brief = nullptr;
    QCheckBox *autoUpload = nullptr;
    QLabel *connectionLabel = nullptr;
    QLabel *status = nullptr;
    QLabel *queueLabel = nullptr;
    QPushButton *record = nullptr;
    QPushButton *replay = nullptr;
    QPushButton *retry = nullptr;
    QPushButton *discard = nullptr;

    void pair()
    {
        if (active || !jobs.isEmpty()) {
            status->setText("Finish or skip queued uploads before changing the connection.");
            return;
        }
        const auto bytes = QApplication::clipboard()->text().toUtf8();
        if (bytes.size() > 8192) { status->setText("Connection settings are too large."); return; }
        const auto data = QJsonDocument::fromJson(bytes).object();
        Connection next{data["apiUrl"].toString(), data["workspaceId"].toString(), data["token"].toString()};
        while (next.apiUrl.endsWith('/')) next.apiUrl.chop(1);
        const QUrl url(next.apiUrl);
        const QRegularExpression workspacePattern("^c[a-z0-9]{24}$");
        const QRegularExpression tokenPattern("^cs_obs_[A-Za-z0-9_-]{43}$");
        if (!safeTransport(url) || url.hasQuery() || url.hasFragment() ||
            !workspacePattern.match(next.workspaceId).hasMatch() || !tokenPattern.match(next.token).hasMatch()) {
            status->setText("Invalid connection. Copy the complete JSON from the app. HTTPS is required except on localhost.");
            return;
        }
        connection = std::move(next);
        connectionLabel->setText("Workspace: " + connection.workspaceId + " (credential not yet verified)");
        status->setText("Connection loaded into memory. It is verified on your first upload. Clear your clipboard; paste again after restarting OBS.");
        updateControls();
    }

    void enqueue(const QString &path)
    {
        if (!connection.ready()) { status->setText("Pair a workspace first. The recording is safe on disk; use Upload an existing clip after pairing."); return; }
        if (jobs.size() >= MaxQueuedJobs) { status->setText("Upload queue is full. Your clip remains on disk; upload it manually later."); return; }
        if (active && active->path == path) return;
        for (const auto &job : jobs) if (job.path == path) return;
        const QFileInfo file(path);
        const auto mime = mimeFor(file.suffix().toLower());
        if (!file.isFile() || !file.isReadable() || file.size() <= 0 || file.size() > MaxBytes || mime.isEmpty()) {
            status->setText("Choose a readable MP4, MOV, WebM, or MKV file up to 2 GiB. The original has not been changed.");
            return;
        }
        Job job;
        job.path = file.absoluteFilePath();
        job.title = title->text().trimmed().isEmpty() ? file.completeBaseName().left(120) : title->text().trimmed();
        job.brief = brief->toPlainText().left(4000);
        job.mimeType = mime;
        job.clientId = QUuid::createUuid().toString(QUuid::WithoutBraces);
        job.size = file.size();
        job.modified = file.lastModified().toMSecsSinceEpoch();
        job.connection = connection;
        jobs.enqueue(std::move(job));
        startNext();
    }

    void startNext()
    {
        if (!active && !jobs.isEmpty()) {
            active = jobs.dequeue();
            failed = false;
            initiate();
        }
        updateControls();
    }
    void updateControls()
    {
        record->setText(obs_frontend_recording_active() ? "Stop recording & upload" : "Start clip recording");
        record->setEnabled(connection.ready());
        replay->setEnabled(connection.ready() && obs_frontend_replay_buffer_active());
        replay->setToolTip("Start the replay buffer in OBS before saving a replay clip.");
        retry->setVisible(active.has_value() && failed);
        discard->setVisible(active.has_value() && failed);
        queueLabel->setText(QString("%1 queued · %2").arg(jobs.size()).arg(active ? (failed ? "Paused after an error" : "Upload in progress") : "Ready"));
    }
    void fail(const QString &reason)
    {
        failed = true;
        status->setText(reason + " Your local recording is safe. Retry or skip this upload.");
        updateControls();
    }
    QNetworkRequest request(const QUrl &url)
    {
        QNetworkRequest request(url);
        request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::ManualRedirectPolicy);
        request.setTransferTimeout(60000);
        return request;
    }
    QString endpoint(const QString &suffix) const
    {
        return active->connection.apiUrl + "/workspaces/" + active->connection.workspaceId + "/clips/" + suffix;
    }
    void sendJson(const QString &url, const QJsonObject &body, std::function<void(QJsonObject)> success)
    {
        auto req = request(QUrl(url));
        req.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
        req.setRawHeader("Authorization", ("Bearer " + active->connection.token).toUtf8());
        auto *reply = network.post(req, QJsonDocument(body).toJson(QJsonDocument::Compact));
        connect(reply, &QNetworkReply::finished, this, [this, reply, success = std::move(success)] {
            const int code = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
            const auto networkError = reply->error();
            const auto payload = reply->read(1024 * 1024);
            reply->deleteLater();
            if (networkError != QNetworkReply::NoError || code < 200 || code >= 300) {
                fail(QString("API request failed (HTTP %1). Check your API URL, credential, and connection.").arg(code));
                return;
            }
            const auto document = QJsonDocument::fromJson(payload);
            if (!document.isObject()) { fail("The API returned an invalid response."); return; }
            success(document.object());
        });
    }
    void initiate()
    {
        if (!active) return;
        const QFileInfo file(active->path);
        if (!file.isFile() || file.size() != active->size || file.lastModified().toMSecsSinceEpoch() != active->modified) {
            fail("The source file changed or moved. Skip it and add the file again."); return;
        }
        status->setText("Preparing: " + active->title);
        sendJson(endpoint("uploads"), {
            {"clientUploadId", active->clientId}, {"title", active->title}, {"brief", active->brief},
            {"fileName", file.fileName()}, {"mimeType", active->mimeType},
            {"sizeBytes", static_cast<double>(active->size)}, {"provider", "KICK"}
        }, [this](const QJsonObject &ticket) {
            active->clipId = ticket["clipId"].toString();
            if (active->clipId.isEmpty()) { fail("The API returned no clip ID."); return; }
            const auto urlString = ticket["uploadUrl"].toString();
            if (urlString.isEmpty()) { complete(); return; }
            const QUrl url(urlString);
            if (!safeTransport(url)) { fail("Storage returned an unsafe upload address."); return; }
            auto req = request(url);
            const auto headers = ticket["headers"].toObject();
            for (auto it = headers.begin(); it != headers.end(); ++it) {
                const auto key = it.key().toLower();
                if (key == "content-type" || key == "if-none-match") req.setRawHeader(it.key().toUtf8(), it.value().toString().toUtf8());
            }
            req.setHeader(QNetworkRequest::ContentLengthHeader, active->size);
            auto *file = new QFile(active->path, this);
            if (!file->open(QIODevice::ReadOnly)) { file->deleteLater(); fail("Could not open the source file."); return; }
            // QFile streams to the network manager; no full recording is loaded into RAM.
            auto *reply = network.put(req, file);
            file->setParent(reply);
            connect(reply, &QNetworkReply::uploadProgress, this, [this](qint64 sent, qint64 total) {
                if (active && total > 0) status->setText(QString("Uploading %1%: %2").arg(sent * 100 / total).arg(active->title));
            });
            connect(reply, &QNetworkReply::finished, this, [this, reply] {
                const int code = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
                const auto error = reply->error();
                reply->deleteLater();
                // The signed conditional PUT is immutable. A retry can legitimately return 412.
                if (code == 412 || (error == QNetworkReply::NoError && code >= 200 && code < 300)) complete();
                else fail(QString("Storage upload failed (HTTP %1).").arg(code));
            });
        });
    }
    void complete()
    {
        status->setText("Verifying your upload…");
        sendJson(endpoint(active->clipId + "/complete"), {}, [this](const QJsonObject &) {
            status->setText("Uploaded: " + active->title + ". Your team can see it now.");
            connectionLabel->setText("Workspace: " + active->connection.workspaceId + " (last upload verified)");
            active.reset();
            failed = false;
            startNext();
        });
    }
};

QPointer<ClipstageDock> dock;
void frontendCallback(enum obs_frontend_event event, void *)
{
    if (event == OBS_FRONTEND_EVENT_FINISHED_LOADING && !dock) {
        dock = new ClipstageDock;
        if (!obs_frontend_add_dock_by_id(DockId, "Clipstage", dock.data())) {
            delete dock.data();
            dock = nullptr;
            blog(LOG_ERROR, "[Clipstage] Unable to create OBS dock");
        }
        return;
    }
    if (dock && event != OBS_FRONTEND_EVENT_EXIT) {
        // OBS frontend callbacks may originate outside the GUI thread.
        QMetaObject::invokeMethod(dock.data(), [event] { if (dock) dock->frontendEvent(event); }, Qt::QueuedConnection);
    }
}
} // namespace

bool obs_module_load(void)
{
    obs_frontend_add_event_callback(frontendCallback, nullptr);
    blog(LOG_INFO, "[Clipstage] Source preview loaded; credentials and queue stay in memory");
    return true;
}
void obs_module_unload(void)
{
    obs_frontend_remove_event_callback(frontendCallback, nullptr);
    if (dock) {
        obs_frontend_remove_dock(DockId);
        if (dock) delete dock.data();
        dock = nullptr;
    }
}
