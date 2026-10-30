# V2 UI kabul görüntüleri

Bu görüntüler kurulu Google Chrome headless ile alındı. Edge bu ortamda yüklü olmadığı için Edge Playwright kabulü çalıştırılmadı ve tarayıcı indirilmedi. Tasarım değiştirilmedi.

Her dosya `contract/docs/v2-ui-screenshots/` altındadır. Ayrıntılı liste `index.json` içindedir.

| Dosya | Ekran | Durum | Görünüm |
| --- | --- | --- | --- |
| `home-jobs-*.png` | `/v2` | İş listesi, reader available | 1440×900 ve 390×844 |
| `jobs-*.png` | `/v2/jobs` | İş listesi, reader available | 1440×900 ve 390×844 |
| `new-job-empty-*.png` | `/v2/jobs/new` | Boş yeni iş formu | 1440×900 ve 390×844 |
| `new-job-filled-*.png` | `/v2/jobs/new` | Dolu yeni iş formu; tarih alanı boş kaldı | 1440×900 ve 390×844 |
| `job-1-0-*.png` | `/v2/jobs/1` | Open | 1440×900 ve 390×844 |
| `job-2-1-*.png` | `/v2/jobs/2` | In progress | 1440×900 ve 390×844 |
| `job-3-2-*.png` | `/v2/jobs/3` | Submitted | 1440×900 ve 390×844 |
| `job-4-3-*.png` | `/v2/jobs/4` | Revision pending | 1440×900 ve 390×844 |
| `job-5-5-*.png` | `/v2/jobs/5` | Disputed | 1440×900 ve 390×844 |
| `job-6-6-*.png` | `/v2/jobs/6` | Completed | 1440×900 ve 390×844 |
| `job-7-7-*.png` | `/v2/jobs/7` | Refunded | 1440×900 ve 390×844 |
| `account-*.png` | `/v2/account` | Hesap/teminat, oturum yok | 1440×900 ve 390×844 |
| `resolver-*.png` | `/v2/resolver` | Resolver kuyruğu, oturum yok | 1440×900 ve 390×844 |
| `wrong-network-*.png` | `/v2/account` | Enjekte cüzdan zinciri 1; bağlantı reddedildi | 1440×900 ve 390×844 |
| `reader-stale-*.png` | `/v2` | Yerel düğüm durduktan sonra reader stale | 1440×900 ve 390×844 |

İş durumları, izole loopback 31337 düğümünde görsel kurulumun yazdığı gerçek işlerden ve indexer senkronundan gelir. Ayrı bir unavailable ekranı üretilmedi; düğüm kapanınca API stale bildirdi.
