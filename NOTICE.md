# Происхождение файлов и авторство

Оригинальный DirtBound: Victor Boutros и Luke Baffait, https://dirtbound.fr/. Публичный клиент и ресурсы получены с сайта 2026-10-31 для запрошенной владельцем приватного репозитория копии и переноса. Это не официальный релиз и не утверждение о наличии разрешения авторов на дальнейшее распространение.

Исходная страница авторства сообщает: «Le jeu, son code et ses créations originales appartiennent à leurs auteurs.» Сохранение публично доставляемого клиентского кода не означает выдачу на него открытой лицензии. Весь репозиторий намеренно не помечен MIT или иной единой свободной лицензией. Оригинальные модели автомобилей, звуки, музыка и шрифты сохраняют собственные условия; наличие файла в клиенте не меняет их.

Как указано в исходном клиенте:

- Основа — mrdoob/Starter-Kit-Racing, MIT.
- Движок Crashcat — isaac-mason/crashcat, MIT. Вендорный файл сохранён с исходным заголовком.
- Kenney Racing Kit и Nature Kit — CC0.
- ARCADE Rally Cars — сторонний платный набор; оригинальные упакованные клиентские файлы сохранены без распаковки или изменений. Покупка/лицензирование набора для иных способов использования этим проектом не предоставляются.
- Three.js — MIT; лицензия: `web/vendor/three/LICENSE`.
- GSAP — сохранённый исходный вендорный файл со своим заголовком/условиями.
- Figtree — SIL Open Font License 1.1. Исходные упакованные шрифты оставлены без изменений.
- Музыка — andriig / Pixabay, условия оригинального источника.
- Звуки — указанные оригиналом Zapsplat и Soundsnap; движок автомобиля также упоминает Honda NSX GT500 2023 / Overtake.
- Go runtime `wasm_exec.js` — Go Authors, BSD; заголовок сохранён. `web/wasm/GO-LICENSE` содержит лицензию Go.
- Go WebSocket — github.com/coder/websocket, MIT; условия в модуле зависимости.

Новые файлы Go-сервера, перенос формул и инструменты сборки созданы для lciga. Отдельная лицензия на них пользователем не выбрана. Ссылки и экран авторства оригинала сохранены.

Музыка меню `web/audio/music/club/niko-b-whys-this-dealer-guy-arthur-remix.m4a`: Niko B — **Why’s This Dealer? (Guy Arthur Remix)**, ремикс Guy Arthur. Источник — [видео на официальном канале Guy Arthur](https://www.youtube.com/watch?v=E44KatuqqCI), аудиодорожка скачана 2026-11-01 по прямому запросу пользователя. В описании автор также указывает [бесплатную загрузку через Hypeddit](https://hypeddit.com/guyarthur/whysthisdealer-remix). AAC перепакован из DASH в M4A с быстрым началом загрузки без перекодирования; добавлены название и исполнитель. Свободная лицензия на запись не заявляется. Файл используется только в меню, автор не связан с этой игрой.

Добавленные записи отстрелов `web/audio/backfire/1.wav`–`3.wav`: Jonas Jocys, **Audi R8 Idling Reving Backfire.wav**, 2019, [Freesound №457733](https://freesound.org/people/Jonas_Jocys/sounds/457733/), [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). Источник — публичная HQ MP3-версия записи. Изменения: вырезаны короткие фрагменты заднего микрофона на 71.725, 72.002 и 79.565 секундах; ослаблен гул ниже 90 Гц, нормализована громкость, добавлены краевые затухания, экспорт в mono PCM16 WAV. Скрипт обработки: `tools/cut-backfires.py`. Автор оригинала не связан с этой версией игры.

Пользовательская наклейка удалена из текущей версии по просьбе пользователя. Объёмная надпись `Racing Club 1sk4nd3r` использует контуры символов исходного клиентского шрифта Brand; генератор: `tools/build-logo-font.py`.

Шесть дополнительных публично опубликованных трасс получены 2026-11-01 через API каталога DirtBound. Это пользовательские адаптации, а не официальные модели автодромов:

- Circuit de Spa-Francorchamps — jega; [исходная трасса](https://dirtbound.fr/play.html?circuit=b409aaff015e8d4f85f167765fbf2ab121c319ddc5f3addb103147de1b941ae4).
- Monaco — SkyNight; [исходная трасса](https://dirtbound.fr/play.html?circuit=60503d1345e366fd7cb17d0daab6e2cd4667f1544c31b852df267efcbf58f8ba).
- Nürburgring - Nordschleife — Nightmare; [исходная трасса](https://dirtbound.fr/play.html?circuit=0e117b17e58c3915fe7dcb1ba05034e9348c13b4d0899b1c40ff3918b51b2348).
- Mountain Circuit — MidNight; [исходная трасса](https://dirtbound.fr/play.html?circuit=889e4be0059c2b5b884a72cc35f43cd1727eb541fbf0ca24143770dc0a50361c).
- Drift Rally Track — ItsST1; [исходная трасса](https://dirtbound.fr/play.html?circuit=5c4b6f5ceecd8e1b468864e7b03596e43480df2ed451e20bb684dcd66ad031e8).
- Bridges Meadow — SkyNight; [исходная трасса](https://dirtbound.fr/play.html?circuit=1e3ed8c43a8e2af3c70bfe15073f6895fb4ed296370dd57fe72efa4367235264).

PostgreSQL-драйвер pgx — github.com/jackc/pgx, MIT; используется как модуль Go. Новые SVG-превью и панель личного кабинета созданы для этого проекта.

Дополнительные записи локального плейлиста меню скачаны 2026-11-01 с YouTube по прямому запросу пользователя. Источники — публикации исполнителей, лейблов и автоматические публикации дистрибьюторов; для One Good Reason (Instrumental) отдельно согласована сторонняя публикация канала NFS Music. Для всех файлов AAC перепакован в M4A с быстрым началом загрузки без перекодирования, добавлены исполнитель и название. Записи не объявляются свободно лицензированными; они воспроизводятся только в меню.

| Запись | Источник |
| --- | --- |
| Styles of Beyond — Nine Thou (Superstars Remix) | [YouTube](https://www.youtube.com/watch?v=M_s95No5E-s) |
| Celldweller feat. Styles of Beyond — Shapeshifter | [YouTube](https://www.youtube.com/watch?v=kRrOq4NipQQ) |
| Celldweller — One Good Reason (Instrumental) | [NFS Music / YouTube](https://www.youtube.com/watch?v=DJ7nCFwZJIU) |
| Disturbed — Decadence | [YouTube](https://www.youtube.com/watch?v=-daTpfB-7K4) |
| Static-X — Skinnyman | [YouTube](https://www.youtube.com/watch?v=EIZa5k7Wgsk) |
| The Prodigy — You’ll Be Under My Wheels | [YouTube](https://www.youtube.com/watch?v=wFAA0_Acvqw) |
| Bullet for My Valentine — Hand of Blood | [YouTube](https://www.youtube.com/watch?v=c0SrxSMHDmE) |
| Avenged Sevenfold — Blinded in Chains | [YouTube](https://www.youtube.com/watch?v=TYgxM_suaUw) |
| Dave Rodgers — Déjà Vu | [YouTube](https://www.youtube.com/watch?v=UT7O7FyUbxA) |
| Max Coveri — Running in the 90’s | [YouTube](https://www.youtube.com/watch?v=NNaJxMutEIE) |
| Manuel — Gas Gas Gas | [YouTube](https://www.youtube.com/watch?v=_nJBYFea2E8) |
| Dave Rodgers — Beat of the Rising Sun | [YouTube](https://www.youtube.com/watch?v=5WyN2y2FPnQ) |

Yaris Mode: модель GR Yaris `web/models/yaris.glb` создана процедурно генератором `tools/build-yaris.mjs` по фотографии пользователя и официальным проекциям Toyota в визуальном стиле машин игры. Источники размеров и видов, а также правила для следующих моделей перечислены в [docs/vehicle-style.md](docs/vehicle-style.md). Перед направлен по +Z; геометрия и материалы общие для всех игроков. Референс анимации предоставлен пользователем: [UralCUP yaris](https://github.com/1sk4nd3r/UralCUP-2026-Writeups/tree/main/tasks/web/yaris). Эффект в `YarisMode.js` адаптирован из [bounce.js](https://github.com/1sk4nd3r/UralCUP-2026-Writeups/blob/main/tasks/web/yaris/front/src/bounce.js): цикл 2,2 Гц, быстрый участок 12%, масштаб 0,8–1,2. Меняется только визуальный узел, не физическое тело. Авторство исходных ресурсов и условия сторонних лицензий сохраняются; переоформление интерфейса их не отменяет.

Билборды `web/images/club-billboard.jpg`: изображение предоставлено пользователем для оформления трасс. GR Yaris получила процедурные гоночные окрасы; геометрия и материалы кешируются по пяти вариантам.
