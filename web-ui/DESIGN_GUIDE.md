# OddsEcho — UI Tasarim Rehberi

Bu rehber, web-ui icin tum frontend calismalarina uygulanacak tasarim kurallarini tanimlar.
Claude bu dosyayi her UI degisikliginde referans alir.

---

## Tasarim Felsefesi

**Konsept:** "Dark Analytics Terminal" — Profesyonel spor analiz platformu.
Bloomberg Terminal, ESPN analytics ve modern sportsbook arayuzlerinden ilham alinir.
Karanlik zemin uzerinde parlak veri noktalari, temiz tipografi ve bilgi yogun layout.

**Kacinilacaklar (AI Slop):**
- Inter, Roboto, Arial, system-ui fontlari
- Mor gradient + beyaz arka plan kombinasyonu
- Her yere yuvarlatilmis koseler (rounded-2xl her yerde)
- Generic hero section layout'lari
- Asiri bos alan (sparse layout)
- Soluk, cekingen renk paleti

---

## Renk Sistemi

Tum renkler CSS degiskeni olarak `globals.css` icinde tanimlanir ve Tailwind ile kullanilir.

### Ana Palet

```
--bg-primary: #0B0F19          /* Koyu lacivert — ana arka plan */
--bg-secondary: #111827        /* Hafif acik — kart/panel arka plani */
--bg-tertiary: #1E293B         /* Sidebar, hover state */
--bg-elevated: #1A2332         /* Yukseltilemis kartlar */

--border-primary: #1E293B      /* Ana border */
--border-subtle: #ffffff0d     /* Cok ince ayirici */
--border-accent: #3B82F620     /* Vurgulu border (mavi glow) */

--text-primary: #F1F5F9        /* Ana metin — acik gri */
--text-secondary: #94A3B8      /* Ikincil metin */
--text-tertiary: #64748B       /* Ucuncul metin, placeholder */
--text-muted: #475569          /* Devre disi, hint */
```

### Veri Renkleri (Odds & Sonuclar)

```
--accent-win: #10B981          /* Ev sahibi galibiyeti, basarili eslesme — Emerald */
--accent-draw: #F59E0B         /* Beraberlik — Amber */
--accent-loss: #EF4444         /* Deplasman, kayip — Red */
--accent-blue: #3B82F6         /* Link, aktif sekme, oran vurgusu */
--accent-cyan: #06B6D4         /* Istatistik, grafik vurgusu */
--accent-purple: #8B5CF6       /* Ozel badge, premium gosterge */

/* Dusuk opasite versiyonlari — arka plan icin */
--accent-win-bg: #10B98115
--accent-draw-bg: #F59E0B15
--accent-loss-bg: #EF444415
--accent-blue-bg: #3B82F615
```

### Glow & Efekt

```
--glow-blue: 0 0 20px #3B82F630
--glow-green: 0 0 15px #10B98125
--glow-amber: 0 0 15px #F59E0B20
```

---

## Tipografi

### Font Secimi

```css
/* Display & Baslik — kalin, karakter sahibi */
--font-display: 'Space Grotesk', sans-serif;
/* Govde metni — temiz, okunakli */
--font-body: 'Plus Jakarta Sans', sans-serif;
/* Veri & Oranlar — monospace, hizali */
--font-mono: 'JetBrains Mono', 'Geist Mono', monospace;
```

Google Fonts import:
```
Space Grotesk: 500, 600, 700
Plus Jakarta Sans: 400, 500, 600
JetBrains Mono: 400, 500
```

### Boyut Skalasi

| Kullanim | Sinif | Boyut |
|----------|-------|-------|
| Sayfa basligi | `text-2xl font-bold` | 24px, Space Grotesk |
| Section basligi | `text-lg font-semibold` | 18px, Space Grotesk |
| Kart basligi | `text-sm font-semibold` | 14px, Plus Jakarta Sans |
| Govde metni | `text-sm` | 14px, Plus Jakarta Sans |
| Etiket / Label | `text-xs font-medium` | 12px, Plus Jakarta Sans |
| Oran degeri | `text-sm font-mono font-medium` | 14px, JetBrains Mono |
| Kucuk veri | `text-[11px] font-mono` | 11px, JetBrains Mono |

### Kurallar
- Oranlar ve sayisal degerler **her zaman** `font-mono` ile yazilir
- Basliklar `font-display` (Space Grotesk) kullanir
- Govde metni `font-body` (Plus Jakarta Sans) kullanir
- Letter-spacing: basliklar `tracking-tight`, etiketler `tracking-wide uppercase`

---

## Layout & Grid

### Sayfa Yapisi

```
max-w-[1600px] mx-auto px-4 md:px-6 lg:px-8
```

Onceki `max-w-[1400px]` yerine `1600px` — veri yogun ekranlarda daha fazla alan.

### Panel Layout (Sidebar + Content)

```
grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 lg:gap-6
```

### Kart Grid

```
grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4
```

### Spacing Skalasi

| Kullanim | Deger |
|----------|-------|
| Ic padding — kucuk kart | `p-3` |
| Ic padding — standart kart | `p-4` |
| Ic padding — buyuk panel | `p-5 md:p-6` |
| Element araligi | `gap-3` veya `gap-4` |
| Section araligi | `gap-6` veya `gap-8` |

---

## Bilesenler (Component Patterns)

### Kart

```html
<div class="
  bg-[var(--bg-secondary)]
  border border-[var(--border-primary)]
  rounded-lg
  p-4
  backdrop-blur-sm
">
```

**Vurgulu kart** (hover veya onemli):
```
hover:border-[var(--border-accent)]
hover:shadow-[var(--glow-blue)]
transition-all duration-200
```

### Tablo

```
/* Header */
bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]
text-xs font-medium uppercase tracking-wider

/* Satir */
border-b border-[var(--border-subtle)]
hover:bg-[var(--bg-tertiary)]
transition-colors

/* Oran hucreleri */
font-mono text-sm text-right tabular-nums

/* Eslesen oran vurgusu */
bg-[var(--accent-win-bg)] text-[var(--accent-win)] font-semibold
```

### Buton

**Primary:**
```
bg-[var(--accent-blue)] text-white
px-4 py-2 rounded-md
font-medium text-sm
hover:brightness-110
active:brightness-90
transition-all
```

**Secondary / Ghost:**
```
bg-transparent
border border-[var(--border-primary)]
text-[var(--text-secondary)]
px-3 py-2 rounded-md
hover:bg-[var(--bg-tertiary)]
hover:text-[var(--text-primary)]
transition-all
```

**Pill / Toggle:**
```
px-3 py-1.5 rounded-md text-xs font-medium
/* Aktif */ bg-[var(--accent-blue-bg)] text-[var(--accent-blue)] border border-[var(--accent-blue)]30
/* Pasif */ bg-transparent text-[var(--text-tertiary)] border border-transparent
```

### Input

```
bg-[var(--bg-primary)]
border border-[var(--border-primary)]
rounded-md px-3 py-2
text-sm text-[var(--text-primary)]
placeholder:text-[var(--text-muted)]
focus:border-[var(--accent-blue)]
focus:ring-1 focus:ring-[var(--accent-blue)]30
transition-colors
```

### Badge / Etiket

```
/* Basarili */ bg-[var(--accent-win-bg)] text-[var(--accent-win)] border border-[var(--accent-win)]25
/* Uyari */   bg-[var(--accent-draw-bg)] text-[var(--accent-draw)] border border-[var(--accent-draw)]25
/* Hata */    bg-[var(--accent-loss-bg)] text-[var(--accent-loss)] border border-[var(--accent-loss)]25
/* Bilgi */   bg-[var(--accent-blue-bg)] text-[var(--accent-blue)] border border-[var(--accent-blue)]25

px-2 py-0.5 rounded text-xs font-mono font-medium
```

### Header / Navigation

```
bg-[var(--bg-secondary)]/80
backdrop-blur-md
border-b border-[var(--border-primary)]
sticky top-0 z-50
```

Nav linkleri:
```
/* Normal */ text-[var(--text-tertiary)] hover:text-[var(--text-primary)]
/* Aktif */  text-[var(--accent-blue)] border-b-2 border-[var(--accent-blue)]
font-medium text-sm
transition-colors
```

---

## Veri Gorsellestirme

### Progress Bar / Oran Cubugu

```
/* Container */ h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden
/* Fill */      h-full rounded-full transition-all duration-500

/* Renkler duruma gore: */
Galibiyet: bg-[var(--accent-win)]
Beraberlik: bg-[var(--accent-draw)]
Maglubiyet: bg-[var(--accent-loss)]
```

### Istatistik Karti

```html
<div class="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg p-4">
  <span class="text-xs text-[var(--text-tertiary)] uppercase tracking-wider">Eslesme</span>
  <span class="text-2xl font-display font-bold text-[var(--text-primary)] mt-1">847</span>
  <span class="text-xs font-mono text-[var(--accent-win)]">+12.4%</span>
</div>
```

### Recharts Tema

```js
const chartTheme = {
  backgroundColor: 'transparent',
  textColor: '#94A3B8',
  gridColor: '#1E293B',
  colors: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#06B6D4', '#8B5CF6'],
  tooltip: {
    backgroundColor: '#1A2332',
    borderColor: '#1E293B',
    textColor: '#F1F5F9',
  }
};
```

---

## Animasyon & Motion

### Sayfa Girisi (Staggered Reveal)

```css
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

.animate-in {
  animation: fadeInUp 0.4s ease-out forwards;
}

/* Her child icin stagger */
.stagger > *:nth-child(1) { animation-delay: 0ms; }
.stagger > *:nth-child(2) { animation-delay: 60ms; }
.stagger > *:nth-child(3) { animation-delay: 120ms; }
.stagger > *:nth-child(4) { animation-delay: 180ms; }
```

### Hover & Transition

```
transition-all duration-200 ease-out
```

- Kartlar: hover'da hafif `border-color` ve `box-shadow` degisimi
- Tablo satirlari: hover'da `background-color` degisimi
- Butonlar: hover'da `brightness` degisimi
- Asla `transform: scale()` ile buyutme yapilmaz — veri yogun arayuzde dikkat dagitir

### Skeleton Loading

```css
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.skeleton {
  background: linear-gradient(90deg, var(--bg-tertiary) 25%, var(--bg-elevated) 50%, var(--bg-tertiary) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
}
```

---

## Arka Plan & Atmosfer

### Sayfa Arka Plani

```css
body {
  background-color: var(--bg-primary);
  /* Hafif radial gradient — derinlik hissi */
  background-image:
    radial-gradient(ellipse at 20% 50%, #1E293B40 0%, transparent 50%),
    radial-gradient(ellipse at 80% 20%, #3B82F608 0%, transparent 40%);
}
```

### Grid / Dot Pattern (opsiyonel — ana sayfa)

```css
.bg-grid {
  background-image:
    linear-gradient(var(--border-subtle) 1px, transparent 1px),
    linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px);
  background-size: 40px 40px;
}
```

---

## Responsive Kurallari

| Breakpoint | Davranis |
|------------|----------|
| `< 768px` (mobile) | Tek kolon, sidebar gizli, tablo yatay scroll |
| `768-1024px` (tablet) | 2 kolon grid, sidebar collapse |
| `> 1024px` (desktop) | Tam layout, sidebar acik, genis tablo |
| `> 1400px` (wide) | Ekstra kolon, daha genis tablo |

### Tablo Mobile Uyumu
- Genis tablolar: `overflow-x-auto` ile yatay scroll
- Kritik kolonlar (takim, skor, MS 1/X/2): her zaman gorunur
- Detay kolonlari: `hidden md:table-cell`

---

## Ozel Kurallar — Bu Projeye Ozel

1. **Oran hucreleri**: Her zaman `font-mono tabular-nums text-right` olmali
2. **Eslesen oranlar**: `accent-win` rengiyle vurgulanir, arka plan `accent-win-bg`
3. **Sonuc gostergesi**: Galibiyet/Beraberlik/Maglubiyet icin tutarli renk kullanimi (yesil/sari/kirmizi)
4. **Kategori badge'leri**: Her odds kategorisi (MS, IY/MS, Alt/Ust vb.) icin tutarli renk atanir
5. **Tolerans gostergesi**: Slider'larda deger degistikce renk gecisi (dusuk=yesil, yuksek=sari)
6. **Turkce icerik**: Tum UI metinleri Turkce, tarih formati `dd.MM.yyyy`, sayi formati `tr-TR`
7. **Tablo yogunlugu**: Compact mod varsayilan — `py-2 px-3` ile yogun veri gosterimi
8. **Numara hizalama**: Tum sayilar `tabular-nums` ile sabit genislikte gosterilir
