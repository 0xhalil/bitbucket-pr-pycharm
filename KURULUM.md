# Ekip Kurulumu (2 dakika)

Gerekenler: macOS, Chrome, PyCharm (`/Applications` altinda), Bitbucket'e SSH erisimi.

## 1. Helper'i kur (terminalde tek komut)

```bash
git clone <BU-REPONUN-ADRESI> && cd bitbucket-pr && ./install.sh
```

Bu komut helper'i kurar, hemen baslatir ve bundan sonra bilgisayari her
actiginda otomatik baslayacak sekilde ayarlar. Basariliysa sunu gorursun:

```
OK: helper calisiyor (http://127.0.0.1:8765).
```

## 2. Extension'i ekle (Chrome'da bir kez)

1. `chrome://extensions` ac
2. Sag ustte **Developer mode**'u ac
3. **Load unpacked**'e tikla, su klasoru sec:
   `~/bb-pycharm/extension` (Ev dizininde, gizli degil)

## 3. Kullan

Bitbucket'ta herhangi bir PR'in diff sayfasini ac, sag alttaki butonlara bas:

- **Dosyayı PyCharm'da Aç** — dosyanin PR halini acar
- **Projeyi Aç** — tum projeyi PR branch'inde acar
- **Diff'i Aç** — PyCharm diff penceresinde once/sonra karsilastirmasi

Not: inceledigin repo bilgisayarda hic clone'lu degilse ilk tikta SSH ile
otomatik indirilir (`~/developer/<repo>` altina).

## Kaldirma

```bash
cd <bitbucket-pr-klonu> && ./uninstall.sh
```

ayrica `chrome://extensions`'tan extension'i Remove ile kaldir.
