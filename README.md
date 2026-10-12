# Bitbucket PR -> PyCharm (tek tik, tokensiz)

Bitbucket PR diff sayfasindaki dosyayi veya tum projeyi tek tikla PR branch'inde
PyCharm'da acar. API token gerekmez; mevcut git/SSH erisini kullanir.
Mevcut checkout'una dokunmaz (`/tmp/bb-pr` altinda git worktree acar).

## Bilesenler

- `pycharm-pr-helper.py` — local server (`http://127.0.0.1:8765`)
- `extension/` — Chrome extension (Manifest V3, basli basina, Tampermonkey gerekmez)

## Kurulum

Hizli yol (onerilen): `./install.sh` — helper'i kurar, baslatir, login'de
otomatik baslayacak sekilde ayarlar. Ekibe dagitim icin `KURULUM.md`'ye bak.

Manuel: `nohup python3 pycharm-pr-helper.py > helper.log 2>&1 &`
Test: `curl -s http://127.0.0.1:8765/health` -> `{"ok": true}`

2. Chrome'da `chrome://extensions` ac, sag ustte **Developer mode**'u aktif et,
   **Load unpacked** ile `extension/` klasorunu yukle.

## Kullanim

Bitbucket'ta herhangi bir PR sayfasinda sag altta uc buton cikar:

- **Dosyayı PyCharm'da Aç** — diff'te tikladigin dosyayi PR branch'inin haliyle,
  proje context'i icinde acar (kodun devami dahil tum dosya + tum repo gorunur,
  istedigin baska dosyaya da bakabilirsin).
- **Projeyi Aç** — PR branch'ini worktree olarak acip tum projeyi PyCharm'da acar.
- **Diff'i Aç** — PyCharm'in diff penceresini acar: dosyadaysan o dosyanin
  once/sonra karsilastirmasi, degilsen tum PR'in klasor diff'i (degisen dosyalar
  arasi gezinme dahil). Base taraf merge-base'dir, yani Bitbucket'in gosterdigi
  diff ile ayni mantik. Yeni/silinmis dosyada tek taraf acilip bilgi verilir.
- **AI için Kopyala** — diff'i (dosyadaysan dosya, degilsen tum PR) unified diff
  olarak panoya kopyalar; AI review icin yapistirirsin. 200K karakterde kesilir.

Repo ilk seferde **tum bilgisayarda** aranir (Spotlight + home dizini),
bulunca `~/.config/bb-pycharm-helper/repos.json`'a kaydedilir.
Local'de hic yoksa SSH ile `~/developer/<repo>` altina clone'lanmaya calisilir.
