/**
 * ============================================================================
 *  BU DOSYA BOŞALDI — 6. turun üç bulgusu da düzeltildi.
 * ============================================================================
 *
 *  Bulgular:
 *    - kategori sicili ajanın kendi etiketinden geliyordu
 *    - etiket değiştirilerek aynı işlerden çok kategoride sicil toplanıyordu
 *    - getJobsPaged limit üst sınırı yoktu
 *
 *  Üçü de regresyon testlerine taşındı: exploit.test.js
 *  Dosya, tur numaralarının izini kaybetmemek için bırakıldı; yeni bir
 *  bulgu turu gelirse buraya yazılabilir.
 * ============================================================================
 */
