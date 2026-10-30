# Kiểm kê nội dung Học tập theo bài

Generated from the catalog: `python -m app.lesson_catalog inventory --markdown` (from `backend/`). Regenerate it after
changing a lesson file. How lessons are written: [LESSON_CONTENT.md](LESSON_CONTENT.md); the flow and rules:
[LEARNING_GAMES.md](LEARNING_GAMES.md#học-theo-bài).

**Basis.** Subjects per grade: Chương trình GDPT 2018 (Thông tư 32/2018/TT-BGDĐT, amended by 20/2021, 13/2022 and
17/2025). Every lesson file is organised **by the curriculum's topics** (`organization: topic`), not by a textbook's
table of contents. All content was written for Mirabi and is `checked` (written and checked by its author, checked by
the validator and the tests); **no lesson is teacher-reviewed yet** (`teacher_reviewed`), and the grade placement of
some knowledge points is the authors' reading of the curriculum: a teacher should confirm it (see *Cần thẩm định*).

**Totals (12 grades):** 498 lessons ready to play out of 2 036 listed (the others are listed as *Đang biên soạn*,
without a play button), 623 games published in lessons, 3 560 reviewed questions or tasks (cards, sentences, words,
levels) plus 47 Math games whose problems are generated from the lesson's settings.

| Lớp | Môn/hoạt động trong chương trình | Có bài sẵn sàng | Bài sẵn sàng / trong danh mục | Trò trong bài | Câu hỏi đã soát |
|---|---|---|---|---|---|
| 1 | 10 | 9 | 37 / 110 | 48 | 262 |
| 2 | 10 | 9 | 38 / 114 | 49 | 228 |
| 3 | 11 | 10 | 45 / 139 | 57 | 285 |
| 4 | 12 | 11 | 42 / 154 | 47 | 294 |
| 5 | 12 | 11 | 45 / 147 | 52 | 324 |
| 6 | 15 | 12 | 46 / 188 | 55 | 312 |
| 7 | 15 | 12 | 38 / 169 | 47 | 274 |
| 8 | 15 | 12 | 39 / 175 | 46 | 277 |
| 9 | 15 | 12 | 37 / 176 | 44 | 257 |
| 10 | 20 | 16 | 45 / 223 | 64 | 375 |
| 11 | 20 | 16 | 42 / 218 | 58 | 342 |
| 12 | 20 | 16 | 44 / 223 | 56 | 330 |

The subjects without lessons in every grade are the ones that depend on the province or the school: Nội dung giáo
dục của địa phương (6–12), Tiếng dân tộc thiểu số (1–12), Ngoại ngữ 2 (6–12) and Chuyên đề học tập lựa chọn (10–12).
They are listed with the reason and cannot be opened.

## Còn thiếu

- **Lessons**: 1 538 listed lessons are not written yet (*Đang biên soạn*); every subject and grade still has some.
  The thinnest: Vật lí, Hoá học, Sinh học, Lịch sử, Địa lí 10–12 (2–4 ready lessons per grade), Hoạt động trải
  nghiệm (1 per grade), Giáo dục thể chất 3 and 11 (1), Toán 7–12 (4–6 ready per grade; geometry, coordinates,
  limits, conditional probability are planned: they need figures).
- **Games not built**: listening (Âm nhạc, Tiếng Anh nghe/chọn: the games play no audio), simulations (lắp mạch điện,
  thí nghiệm ảo), an interactive map (Khám phá bản đồ: map questions are text), interactive charts (Địa lí reads
  numbers given in a passage), drawing and geometry figures, step-by-step written calculation (nhân/chia nhiều chữ
  số), speaking and writing. Practice subjects (GDTC, Âm nhạc, Mĩ thuật, Công nghệ, HĐTN) only revise knowledge,
  safety and order of steps; their practical lessons are listed as planned and done with the teacher.
- **Languages**: only Tiếng Anh as Ngoại ngữ 1.
- **Sổ tay**: there is no notebook feature; wrong answers go to *Cần ôn* (per chapter) and the vocabulary to *Từ đã học*.

## Cần thẩm định (teacher review)

The authors flagged these for a teacher (placement by grade unless said otherwise):
- Tiếng Anh: the grade of each grammar point (comparatives 6, past simple 7, conditional 1 in 8, present perfect 9,
  passive 10, relative clauses 11, reported speech 12).
- Tiếng Việt / Ngữ văn: đảo ngữ, câu hỏi tu từ (8), nói mỉa, nghịch ngữ (12), tùy bút / tản văn (11); hoán dụ types (6).
- Toán: km/h vs km/giờ in grade 5; nguyên hàm limited to the basic table (12).
- Khoa học / KHTN: heat conductors (4) vs electrical conductors (5); animal life cycles in grade 5; blood pressure (KHTN 8).
- Vật lí / Hoá / Sinh: constants stated in each question (textbooks may round differently); IUPAC metal names; con
  người as an biotic factor (Sinh 12); C3/C4/CAM in grade 11.
- Lịch sử và Địa lí: 7 economic regions (Bắc Trung Bộ and Duyên hải Nam Trung Bộ separate); the amended Lịch sử 4 and
  10 requirements of Thông tư 17/2025 were not checked line by line; no ASEAN member count is given (Timor-Leste 2025).
- GDCD / GDKT&PL / GDQP&AN: the GDCD amendments of Thông tư 17/2025; GDQP&AN topic placement; legal facts are stated
  as stable principles ("theo quy định hiện hành"), without article numbers.
- Tin học / Công nghệ: file extensions (7), spreadsheet functions (9), Công nghệ 9 modules, ICT/CS orientations (11–12).
- Âm nhạc: the grade of each theory point (móc đơn, 2/4 in 4; 3/4, chấm dôi in 5; …; quãng, hợp âm in 9).

## Theo từng khối

### Lớp 1

9 môn/hoạt động có trong Mirabi trên 10 của chương trình · 37 bài sẵn sàng · 262 câu hỏi/nhiệm vụ đã soát

| Môn | Loại | Chương | Bài sẵn sàng / trong danh mục | Trò chơi (số bài dùng) | Câu hỏi | Trạng thái |
|---|---|---|---|---|---|---|
| Tiếng Việt | Bắt buộc | 6 | 6 / 18 | Ghép chữ ×3, Chọn đáp án ×2, Sắp xếp ×1 | 46 | Còn 12 bài đang biên soạn |
| Toán | Bắt buộc | 6 | 12 / 19 | Xây cầu toán ×6, Bảo vệ căn cứ ×4, Sắp xếp ×3, Chọn đáp án ×3, Ghép cặp ×2 | 43 (+10 trò sinh đề) | Còn 7 bài đang biên soạn |
| Tiếng Anh | Môn tự chọn | 4 | 2 / 9 | Ghép cặp ×1, Việt → Anh ×1, Anh → Việt ×1 | 33 | Còn 7 bài đang biên soạn |
| Đạo đức | Bắt buộc | 5 | 3 / 12 | Chọn đáp án ×3, Phân loại ×1, Sắp xếp ×1 | 29 | Còn 9 bài đang biên soạn |
| Tự nhiên và Xã hội | Bắt buộc | 6 | 5 / 20 | Phân loại ×2, Chọn đáp án ×1, Ghép cặp ×1, Sắp xếp ×1 | 35 | Còn 15 bài đang biên soạn |
| Âm nhạc | Bắt buộc | 5 | 3 / 9 | Phân loại ×1, Chọn đáp án ×1, Sắp xếp ×1, Ghép cặp ×1 | 23 | Còn 6 bài đang biên soạn |
| Mĩ thuật | Bắt buộc | 4 | 3 / 8 | Phân loại ×2, Chọn đáp án ×1 | 25 | Còn 5 bài đang biên soạn |
| Giáo dục thể chất | Bắt buộc | 4 | 2 / 7 | Phân loại ×1, Sắp xếp ×1 | 15 | Còn 5 bài đang biên soạn |
| Hoạt động trải nghiệm | Hoạt động giáo dục bắt buộc | 4 | 1 / 8 | Chọn đáp án ×1, Phân loại ×1 | 13 | Còn 7 bài đang biên soạn |
| Tiếng dân tộc thiểu số | Môn tự chọn | 0 | 0 / 0 | — | 0 | Không hỗ trợ: Tuỳ ngôn ngữ và điều kiện của từng trường: Mirabi chưa có bài học. |

### Lớp 2

9 môn/hoạt động có trong Mirabi trên 10 của chương trình · 38 bài sẵn sàng · 228 câu hỏi/nhiệm vụ đã soát

| Môn | Loại | Chương | Bài sẵn sàng / trong danh mục | Trò chơi (số bài dùng) | Câu hỏi | Trạng thái |
|---|---|---|---|---|---|---|
| Tiếng Việt | Bắt buộc | 5 | 6 / 18 | Chính tả ×2, Ghép chữ ×1, Phân loại ×1, Sắp xếp ×1, Chọn đáp án ×1 | 50 | Còn 12 bài đang biên soạn |
| Toán | Bắt buộc | 6 | 13 / 24 | Bảo vệ căn cứ ×8, Xây cầu toán ×7, Chọn đáp án ×2, Ghép cặp ×2 | 21 (+15 trò sinh đề) | Còn 11 bài đang biên soạn |
| Tiếng Anh | Môn tự chọn | 4 | 2 / 10 | Ghép cặp ×1, Việt → Anh ×1, Anh → Việt ×1 | 33 | Còn 8 bài đang biên soạn |
| Đạo đức | Bắt buộc | 6 | 3 / 11 | Chọn đáp án ×3, Sắp xếp ×1, Phân loại ×1 | 29 | Còn 8 bài đang biên soạn |
| Tự nhiên và Xã hội | Bắt buộc | 6 | 5 / 20 | Chọn đáp án ×2, Phân loại ×2, Ghép cặp ×1 | 35 | Còn 15 bài đang biên soạn |
| Âm nhạc | Bắt buộc | 5 | 3 / 10 | Phân loại ×1, Ghép cặp ×1, Chọn đáp án ×1 | 17 | Còn 7 bài đang biên soạn |
| Mĩ thuật | Bắt buộc | 4 | 3 / 7 | Ghép cặp ×2, Phân loại ×1, Sắp xếp ×1 | 20 | Còn 4 bài đang biên soạn |
| Giáo dục thể chất | Bắt buộc | 4 | 2 / 6 | Chọn đáp án ×1, Sắp xếp ×1 | 10 | Còn 4 bài đang biên soạn |
| Hoạt động trải nghiệm | Hoạt động giáo dục bắt buộc | 4 | 1 / 8 | Chọn đáp án ×1, Phân loại ×1 | 13 | Còn 7 bài đang biên soạn |
| Tiếng dân tộc thiểu số | Môn tự chọn | 0 | 0 / 0 | — | 0 | Không hỗ trợ: Tuỳ ngôn ngữ và điều kiện của từng trường: Mirabi chưa có bài học. |

### Lớp 3

10 môn/hoạt động có trong Mirabi trên 11 của chương trình · 45 bài sẵn sàng · 285 câu hỏi/nhiệm vụ đã soát

| Môn | Loại | Chương | Bài sẵn sàng / trong danh mục | Trò chơi (số bài dùng) | Câu hỏi | Trạng thái |
|---|---|---|---|---|---|---|
| Tiếng Việt | Bắt buộc | 6 | 5 / 17 | Chính tả ×2, Chọn đáp án ×2, Ghép cặp ×1 | 36 | Còn 12 bài đang biên soạn |
| Toán | Bắt buộc | 6 | 16 / 28 | Xây cầu toán ×8, Bảo vệ căn cứ ×7, Chọn đáp án ×5, Ghép cặp ×2 | 40 (+15 trò sinh đề) | Còn 12 bài đang biên soạn |
| Tiếng Anh | Bắt buộc | 4 | 4 / 11 | Chọn đáp án ×2, Sắp xếp ×1, Ghép cặp ×1, Việt → Anh ×1, Anh → Việt ×1 | 52 | Còn 7 bài đang biên soạn |
| Đạo đức | Bắt buộc | 6 | 3 / 9 | Chọn đáp án ×3, Ghép cặp ×1, Sắp xếp ×1 | 24 | Còn 6 bài đang biên soạn |
| Tự nhiên và Xã hội | Bắt buộc | 6 | 5 / 23 | Chọn đáp án ×2, Phân loại ×2, Ghép cặp ×1 | 40 | Còn 18 bài đang biên soạn |
| Tin học và Công nghệ | Bắt buộc | 6 | 4 / 21 | Phân loại ×2, Ghép cặp ×1, Sắp xếp ×1, Lập trình ×1 | 31 | Còn 17 bài đang biên soạn |
| Âm nhạc | Bắt buộc | 5 | 3 / 9 | Sắp xếp ×1, Ghép cặp ×1, Phân loại ×1 | 21 | Còn 6 bài đang biên soạn |
| Mĩ thuật | Bắt buộc | 4 | 3 / 7 | Phân loại ×2, Chọn đáp án ×1 | 26 | Còn 4 bài đang biên soạn |
| Giáo dục thể chất | Bắt buộc | 5 | 1 / 6 | Sắp xếp ×1, Chọn đáp án ×1 | 9 | Còn 5 bài đang biên soạn |
| Hoạt động trải nghiệm | Hoạt động giáo dục bắt buộc | 5 | 1 / 8 | Chọn đáp án ×1 | 6 | Còn 7 bài đang biên soạn |
| Tiếng dân tộc thiểu số | Môn tự chọn | 0 | 0 / 0 | — | 0 | Không hỗ trợ: Tuỳ ngôn ngữ và điều kiện của từng trường: Mirabi chưa có bài học. |

### Lớp 4

11 môn/hoạt động có trong Mirabi trên 12 của chương trình · 42 bài sẵn sàng · 294 câu hỏi/nhiệm vụ đã soát

| Môn | Loại | Chương | Bài sẵn sàng / trong danh mục | Trò chơi (số bài dùng) | Câu hỏi | Trạng thái |
|---|---|---|---|---|---|---|
| Tiếng Việt | Bắt buộc | 6 | 5 / 18 | Chính tả ×2, Chọn đáp án ×2, Phân loại ×1 | 40 | Còn 13 bài đang biên soạn |
| Toán | Bắt buộc | 5 | 10 / 24 | Chọn đáp án ×5, Ghép cặp ×3, Xây cầu toán ×1, Bảo vệ căn cứ ×1 | 43 (+2 trò sinh đề) | Còn 14 bài đang biên soạn |
| Tiếng Anh | Bắt buộc | 4 | 4 / 11 | Chọn đáp án ×2, Việt → Anh ×1, Anh → Việt ×1, Sắp xếp ×1, Ghép cặp ×1 | 51 | Còn 7 bài đang biên soạn |
| Đạo đức | Bắt buộc | 5 | 3 / 8 | Chọn đáp án ×3, Ghép cặp ×1, Phân loại ×1 | 30 | Còn 5 bài đang biên soạn |
| Khoa học | Bắt buộc | 6 | 5 / 24 | Chọn đáp án ×2, Phân loại ×2, Sắp xếp ×1 | 41 | Còn 19 bài đang biên soạn |
| Lịch sử và Địa lí | Bắt buộc | 6 | 5 / 22 | Chọn đáp án ×3, Sắp xếp ×1, Phân loại ×1 | 31 | Còn 17 bài đang biên soạn |
| Tin học và Công nghệ | Bắt buộc | 6 | 3 / 18 | Phân loại ×1, Lập trình ×1, Sắp xếp ×1 | 19 | Còn 15 bài đang biên soạn |
| Âm nhạc | Bắt buộc | 5 | 2 / 9 | Ghép cặp ×1, Sắp xếp ×1, Chọn đáp án ×1 | 13 | Còn 7 bài đang biên soạn |
| Mĩ thuật | Bắt buộc | 4 | 2 / 7 | Sắp xếp ×1, Chọn đáp án ×1 | 10 | Còn 5 bài đang biên soạn |
| Giáo dục thể chất | Bắt buộc | 4 | 2 / 4 | Chọn đáp án ×1, Sắp xếp ×1 | 10 | Còn 2 bài đang biên soạn |
| Hoạt động trải nghiệm | Hoạt động giáo dục bắt buộc | 5 | 1 / 9 | Chọn đáp án ×1 | 6 | Còn 8 bài đang biên soạn |
| Tiếng dân tộc thiểu số | Môn tự chọn | 0 | 0 / 0 | — | 0 | Không hỗ trợ: Tuỳ ngôn ngữ và điều kiện của từng trường: Mirabi chưa có bài học. |

### Lớp 5

11 môn/hoạt động có trong Mirabi trên 12 của chương trình · 45 bài sẵn sàng · 324 câu hỏi/nhiệm vụ đã soát

| Môn | Loại | Chương | Bài sẵn sàng / trong danh mục | Trò chơi (số bài dùng) | Câu hỏi | Trạng thái |
|---|---|---|---|---|---|---|
| Tiếng Việt | Bắt buộc | 6 | 5 / 15 | Chọn đáp án ×3, Chính tả ×1, Ghép cặp ×1 | 33 | Còn 10 bài đang biên soạn |
| Toán | Bắt buộc | 5 | 11 / 18 | Chọn đáp án ×8, Ghép cặp ×3 | 60 | Còn 7 bài đang biên soạn |
| Tiếng Anh | Bắt buộc | 4 | 4 / 12 | Chọn đáp án ×2, Sắp xếp ×1, Việt → Anh ×1, Anh → Việt ×1, Ghép cặp ×1 | 52 | Còn 8 bài đang biên soạn |
| Đạo đức | Bắt buộc | 6 | 3 / 8 | Chọn đáp án ×3, Phân loại ×2, Sắp xếp ×1 | 38 | Còn 5 bài đang biên soạn |
| Khoa học | Bắt buộc | 6 | 6 / 24 | Phân loại ×2, Sắp xếp ×2, Chọn đáp án ×1, Ghép cặp ×1 | 40 | Còn 18 bài đang biên soạn |
| Lịch sử và Địa lí | Bắt buộc | 6 | 4 / 24 | Ghép cặp ×2, Chọn đáp án ×1, Sắp xếp ×1, Phân loại ×1 | 26 | Còn 20 bài đang biên soạn |
| Tin học và Công nghệ | Bắt buộc | 6 | 3 / 18 | Chọn đáp án ×2, Sắp xếp ×1 | 17 | Còn 15 bài đang biên soạn |
| Âm nhạc | Bắt buộc | 5 | 3 / 9 | Chọn đáp án ×1, Ghép cặp ×1, Phân loại ×1 | 20 | Còn 6 bài đang biên soạn |
| Mĩ thuật | Bắt buộc | 4 | 3 / 6 | Ghép cặp ×1, Chọn đáp án ×1, Sắp xếp ×1 | 14 | Còn 3 bài đang biên soạn |
| Giáo dục thể chất | Bắt buộc | 3 | 2 / 4 | Chọn đáp án ×1, Ghép cặp ×1 | 9 | Còn 2 bài đang biên soạn |
| Hoạt động trải nghiệm | Hoạt động giáo dục bắt buộc | 5 | 1 / 9 | Chọn đáp án ×1, Phân loại ×1 | 15 | Còn 8 bài đang biên soạn |
| Tiếng dân tộc thiểu số | Môn tự chọn | 0 | 0 / 0 | — | 0 | Không hỗ trợ: Tuỳ ngôn ngữ và điều kiện của từng trường: Mirabi chưa có bài học. |

### Lớp 6

12 môn/hoạt động có trong Mirabi trên 15 của chương trình · 46 bài sẵn sàng · 312 câu hỏi/nhiệm vụ đã soát

| Môn | Loại | Chương | Bài sẵn sàng / trong danh mục | Trò chơi (số bài dùng) | Câu hỏi | Trạng thái |
|---|---|---|---|---|---|---|
| Ngữ văn | Bắt buộc | 5 | 4 / 18 | Chọn đáp án ×2, Ghép cặp ×1, Phân loại ×1 | 28 | Còn 14 bài đang biên soạn |
| Toán | Bắt buộc | 6 | 10 / 24 | Ghép cặp ×3, Bảo vệ căn cứ ×3, Chọn đáp án ×3, Xây cầu toán ×2, Sắp xếp ×1 | 37 (+5 trò sinh đề) | Còn 14 bài đang biên soạn |
| Tiếng Anh | Bắt buộc | 4 | 4 / 12 | Chọn đáp án ×2, Việt → Anh ×1, Anh → Việt ×1, Ghép cặp ×1, Sắp xếp ×1 | 52 | Còn 8 bài đang biên soạn |
| Giáo dục công dân | Bắt buộc | 4 | 3 / 11 | Chọn đáp án ×3, Phân loại ×1, Sắp xếp ×1 | 31 | Còn 8 bài đang biên soạn |
| Khoa học tự nhiên | Bắt buộc | 5 | 5 / 26 | Phân loại ×2, Ghép cặp ×1, Sắp xếp ×1, Chọn đáp án ×1 | 38 | Còn 21 bài đang biên soạn |
| Lịch sử và Địa lí | Bắt buộc | 8 | 5 / 34 | Chọn đáp án ×2, Ghép cặp ×2, Sắp xếp ×1, Phân loại ×1 | 32 | Còn 29 bài đang biên soạn |
| Tin học | Bắt buộc | 6 | 4 / 16 | Ghép cặp ×1, Phân loại ×1, Sắp xếp ×1, Lập trình ×1 | 21 | Còn 12 bài đang biên soạn |
| Công nghệ | Bắt buộc | 4 | 3 / 15 | Phân loại ×1, Sắp xếp ×1, Chọn đáp án ×1 | 23 | Còn 12 bài đang biên soạn |
| Âm nhạc | Bắt buộc | 5 | 2 / 10 | Ghép cặp ×2, Sắp xếp ×1 | 11 | Còn 8 bài đang biên soạn |
| Mĩ thuật | Bắt buộc | 4 | 3 / 7 | Chọn đáp án ×1, Ghép cặp ×1, Sắp xếp ×1 | 13 | Còn 4 bài đang biên soạn |
| Giáo dục thể chất | Bắt buộc | 4 | 2 / 5 | Phân loại ×1, Sắp xếp ×1, Chọn đáp án ×1 | 20 | Còn 3 bài đang biên soạn |
| Hoạt động trải nghiệm, hướng nghiệp | Hoạt động giáo dục bắt buộc | 5 | 1 / 10 | Chọn đáp án ×1 | 6 | Còn 9 bài đang biên soạn |
| Nội dung giáo dục của địa phương | Bắt buộc | 0 | 0 / 0 | — | 0 | Không hỗ trợ: Nội dung do từng tỉnh, thành phố biên soạn và phê duyệt: Mirabi chưa có tài liệu của địa phương nên chưa có bài học. |
| Tiếng dân tộc thiểu số | Môn tự chọn | 0 | 0 / 0 | — | 0 | Không hỗ trợ: Tuỳ ngôn ngữ và điều kiện của từng trường: Mirabi chưa có bài học. |
| Ngoại ngữ 2 | Môn tự chọn | 0 | 0 / 0 | — | 0 | Không hỗ trợ: Tuỳ ngoại ngữ trường chọn: Mirabi chưa có bài học. |

### Lớp 7

12 môn/hoạt động có trong Mirabi trên 15 của chương trình · 38 bài sẵn sàng · 274 câu hỏi/nhiệm vụ đã soát

| Môn | Loại | Chương | Bài sẵn sàng / trong danh mục | Trò chơi (số bài dùng) | Câu hỏi | Trạng thái |
|---|---|---|---|---|---|---|
| Ngữ văn | Bắt buộc | 5 | 3 / 17 | Chọn đáp án ×2, Ghép cặp ×1 | 17 | Còn 14 bài đang biên soạn |
| Toán | Bắt buộc | 6 | 4 / 23 | Chọn đáp án ×4, Ghép cặp ×1 | 29 | Còn 19 bài đang biên soạn |
| Tiếng Anh | Bắt buộc | 4 | 4 / 12 | Chọn đáp án ×2, Việt → Anh ×1, Anh → Việt ×1, Ghép cặp ×1, Sắp xếp ×1 | 52 | Còn 8 bài đang biên soạn |
| Giáo dục công dân | Bắt buộc | 4 | 3 / 10 | Chọn đáp án ×3, Sắp xếp ×1, Ghép cặp ×1 | 22 | Còn 7 bài đang biên soạn |
| Khoa học tự nhiên | Bắt buộc | 6 | 6 / 27 | Ghép cặp ×2, Phân loại ×2, Chọn đáp án ×1, Sắp xếp ×1 | 40 | Còn 21 bài đang biên soạn |
| Lịch sử và Địa lí | Bắt buộc | 7 | 4 / 26 | Ghép cặp ×2, Sắp xếp ×1, Chọn đáp án ×1, Phân loại ×1 | 26 | Còn 22 bài đang biên soạn |
| Tin học | Bắt buộc | 5 | 3 / 12 | Phân loại ×1, Ghép cặp ×1, Chọn đáp án ×1 | 22 | Còn 9 bài đang biên soạn |
| Công nghệ | Bắt buộc | 4 | 2 / 13 | Ghép cặp ×1, Sắp xếp ×1 | 8 | Còn 11 bài đang biên soạn |
| Âm nhạc | Bắt buộc | 5 | 3 / 9 | Ghép cặp ×2, Chọn đáp án ×1, Sắp xếp ×1 | 19 | Còn 6 bài đang biên soạn |
| Mĩ thuật | Bắt buộc | 4 | 2 / 7 | Chọn đáp án ×2, Sắp xếp ×1 | 15 | Còn 5 bài đang biên soạn |
| Giáo dục thể chất | Bắt buộc | 4 | 3 / 4 | Chọn đáp án ×2, Sắp xếp ×1, Ghép cặp ×1 | 18 | Còn 1 bài đang biên soạn |
| Hoạt động trải nghiệm, hướng nghiệp | Hoạt động giáo dục bắt buộc | 5 | 1 / 9 | Chọn đáp án ×1 | 6 | Còn 8 bài đang biên soạn |
| Nội dung giáo dục của địa phương | Bắt buộc | 0 | 0 / 0 | — | 0 | Không hỗ trợ: Nội dung do từng tỉnh, thành phố biên soạn và phê duyệt: Mirabi chưa có tài liệu của địa phương nên chưa có bài học. |
| Tiếng dân tộc thiểu số | Môn tự chọn | 0 | 0 / 0 | — | 0 | Không hỗ trợ: Tuỳ ngôn ngữ và điều kiện của từng trường: Mirabi chưa có bài học. |
| Ngoại ngữ 2 | Môn tự chọn | 0 | 0 / 0 | — | 0 | Không hỗ trợ: Tuỳ ngoại ngữ trường chọn: Mirabi chưa có bài học. |

### Lớp 8

12 môn/hoạt động có trong Mirabi trên 15 của chương trình · 39 bài sẵn sàng · 277 câu hỏi/nhiệm vụ đã soát

| Môn | Loại | Chương | Bài sẵn sàng / trong danh mục | Trò chơi (số bài dùng) | Câu hỏi | Trạng thái |
|---|---|---|---|---|---|---|
| Ngữ văn | Bắt buộc | 5 | 4 / 18 | Chọn đáp án ×2, Ghép cặp ×1, Phân loại ×1 | 24 | Còn 14 bài đang biên soạn |
| Toán | Bắt buộc | 6 | 4 / 16 | Chọn đáp án ×3, Ghép cặp ×1, Sắp xếp ×1 | 28 | Còn 12 bài đang biên soạn |
| Tiếng Anh | Bắt buộc | 4 | 4 / 12 | Chọn đáp án ×2, Việt → Anh ×1, Anh → Việt ×1, Sắp xếp ×1, Ghép cặp ×1 | 52 | Còn 8 bài đang biên soạn |
| Giáo dục công dân | Bắt buộc | 4 | 3 / 10 | Chọn đáp án ×3, Sắp xếp ×1, Phân loại ×1 | 30 | Còn 7 bài đang biên soạn |
| Khoa học tự nhiên | Bắt buộc | 6 | 5 / 40 | Phân loại ×2, Chọn đáp án ×1, Ghép cặp ×1, Sắp xếp ×1 | 37 | Còn 35 bài đang biên soạn |
| Lịch sử và Địa lí | Bắt buộc | 8 | 4 / 25 | Ghép cặp ×2, Sắp xếp ×1, Chọn đáp án ×1 | 16 | Còn 21 bài đang biên soạn |
| Tin học | Bắt buộc | 6 | 2 / 12 | Lập trình ×1, Chọn đáp án ×1 | 9 | Còn 10 bài đang biên soạn |
| Công nghệ | Bắt buộc | 4 | 3 / 15 | Ghép cặp ×1, Phân loại ×1, Sắp xếp ×1 | 20 | Còn 12 bài đang biên soạn |
| Âm nhạc | Bắt buộc | 5 | 3 / 8 | Ghép cặp ×2, Chọn đáp án ×1, Sắp xếp ×1 | 16 | Còn 5 bài đang biên soạn |
| Mĩ thuật | Bắt buộc | 4 | 3 / 7 | Ghép cặp ×1, Chọn đáp án ×1, Phân loại ×1 | 19 | Còn 4 bài đang biên soạn |
| Giáo dục thể chất | Bắt buộc | 3 | 3 / 3 | Phân loại ×1, Sắp xếp ×1, Ghép cặp ×1 | 17 | Đủ bài trong danh mục |
| Hoạt động trải nghiệm, hướng nghiệp | Hoạt động giáo dục bắt buộc | 5 | 1 / 9 | Chọn đáp án ×1, Ghép cặp ×1 | 9 | Còn 8 bài đang biên soạn |
| Nội dung giáo dục của địa phương | Bắt buộc | 0 | 0 / 0 | — | 0 | Không hỗ trợ: Nội dung do từng tỉnh, thành phố biên soạn và phê duyệt: Mirabi chưa có tài liệu của địa phương nên chưa có bài học. |
| Tiếng dân tộc thiểu số | Môn tự chọn | 0 | 0 / 0 | — | 0 | Không hỗ trợ: Tuỳ ngôn ngữ và điều kiện của từng trường: Mirabi chưa có bài học. |
| Ngoại ngữ 2 | Môn tự chọn | 0 | 0 / 0 | — | 0 | Không hỗ trợ: Tuỳ ngoại ngữ trường chọn: Mirabi chưa có bài học. |

### Lớp 9

12 môn/hoạt động có trong Mirabi trên 15 của chương trình · 37 bài sẵn sàng · 257 câu hỏi/nhiệm vụ đã soát

| Môn | Loại | Chương | Bài sẵn sàng / trong danh mục | Trò chơi (số bài dùng) | Câu hỏi | Trạng thái |
|---|---|---|---|---|---|---|
| Ngữ văn | Bắt buộc | 5 | 3 / 18 | Chọn đáp án ×2, Ghép cặp ×1 | 16 | Còn 15 bài đang biên soạn |
| Toán | Bắt buộc | 6 | 5 / 20 | Chọn đáp án ×4, Sắp xếp ×1, Ghép cặp ×1 | 33 | Còn 15 bài đang biên soạn |
| Tiếng Anh | Bắt buộc | 4 | 4 / 13 | Chọn đáp án ×2, Sắp xếp ×1, Việt → Anh ×1, Anh → Việt ×1, Ghép cặp ×1 | 53 | Còn 9 bài đang biên soạn |
| Giáo dục công dân | Bắt buộc | 4 | 3 / 10 | Chọn đáp án ×3, Phân loại ×1, Ghép cặp ×1 | 29 | Còn 7 bài đang biên soạn |
| Khoa học tự nhiên | Bắt buộc | 6 | 5 / 32 | Chọn đáp án ×2, Phân loại ×2, Sắp xếp ×1, Ghép cặp ×1 | 41 | Còn 27 bài đang biên soạn |
| Lịch sử và Địa lí | Bắt buộc | 8 | 4 / 31 | Ghép cặp ×2, Sắp xếp ×1, Chọn đáp án ×1 | 16 | Còn 27 bài đang biên soạn |
| Tin học | Bắt buộc | 6 | 3 / 10 | Phân loại ×1, Chọn đáp án ×1, Sắp xếp ×1 | 21 | Còn 7 bài đang biên soạn |
| Công nghệ | Bắt buộc | 4 | 2 / 14 | Ghép cặp ×1, Sắp xếp ×1 | 7 | Còn 12 bài đang biên soạn |
| Âm nhạc | Bắt buộc | 5 | 3 / 9 | Ghép cặp ×2, Chọn đáp án ×1 | 14 | Còn 6 bài đang biên soạn |
| Mĩ thuật | Bắt buộc | 4 | 2 / 7 | Ghép cặp ×1, Chọn đáp án ×1 | 9 | Còn 5 bài đang biên soạn |
| Giáo dục thể chất | Bắt buộc | 3 | 2 / 4 | Sắp xếp ×1, Chọn đáp án ×1, Ghép cặp ×1 | 12 | Còn 2 bài đang biên soạn |
| Hoạt động trải nghiệm, hướng nghiệp | Hoạt động giáo dục bắt buộc | 4 | 1 / 8 | Chọn đáp án ×1 | 6 | Còn 7 bài đang biên soạn |
| Nội dung giáo dục của địa phương | Bắt buộc | 0 | 0 / 0 | — | 0 | Không hỗ trợ: Nội dung do từng tỉnh, thành phố biên soạn và phê duyệt: Mirabi chưa có tài liệu của địa phương nên chưa có bài học. |
| Tiếng dân tộc thiểu số | Môn tự chọn | 0 | 0 / 0 | — | 0 | Không hỗ trợ: Tuỳ ngôn ngữ và điều kiện của từng trường: Mirabi chưa có bài học. |
| Ngoại ngữ 2 | Môn tự chọn | 0 | 0 / 0 | — | 0 | Không hỗ trợ: Tuỳ ngoại ngữ trường chọn: Mirabi chưa có bài học. |

### Lớp 10

16 môn/hoạt động có trong Mirabi trên 20 của chương trình · 45 bài sẵn sàng · 375 câu hỏi/nhiệm vụ đã soát

| Môn | Loại | Chương | Bài sẵn sàng / trong danh mục | Trò chơi (số bài dùng) | Câu hỏi | Trạng thái |
|---|---|---|---|---|---|---|
| Ngữ văn | Bắt buộc | 5 | 3 / 14 | Chọn đáp án ×2, Ghép cặp ×1 | 16 | Còn 11 bài đang biên soạn |
| Toán | Bắt buộc | 6 | 5 / 22 | Chọn đáp án ×5 | 32 | Còn 17 bài đang biên soạn |
| Tiếng Anh | Bắt buộc | 4 | 4 / 12 | Chọn đáp án ×2, Sắp xếp ×1, Việt → Anh ×1, Anh → Việt ×1, Ghép cặp ×1 | 53 | Còn 8 bài đang biên soạn |
| Giáo dục kinh tế và pháp luật | Môn lựa chọn | 5 | 3 / 12 | Chọn đáp án ×3, Ghép cặp ×2, Sắp xếp ×1 | 25 | Còn 9 bài đang biên soạn |
| Lịch sử | Bắt buộc | 6 | 3 / 16 | Chọn đáp án ×2, Sắp xếp ×1, Ghép cặp ×1 | 18 | Còn 13 bài đang biên soạn |
| Địa lí | Môn lựa chọn | 6 | 3 / 25 | Phân loại ×1, Ghép cặp ×1, Chọn đáp án ×1 | 19 | Còn 22 bài đang biên soạn |
| Vật lí | Môn lựa chọn | 6 | 2 / 22 | Chọn đáp án ×2, Sắp xếp ×1, Ghép cặp ×1 | 22 | Còn 20 bài đang biên soạn |
| Hoá học | Môn lựa chọn | 6 | 3 / 18 | Chọn đáp án ×3, Ghép cặp ×1, Phân loại ×1, Sắp xếp ×1 | 44 | Còn 15 bài đang biên soạn |
| Sinh học | Môn lựa chọn | 5 | 4 / 19 | Chọn đáp án ×2, Phân loại ×1, Ghép cặp ×1, Sắp xếp ×1 | 34 | Còn 15 bài đang biên soạn |
| Tin học | Môn lựa chọn | 6 | 3 / 14 | Chọn đáp án ×2, Ghép cặp ×1, Lập trình ×1 | 19 | Còn 11 bài đang biên soạn |
| Công nghệ | Môn lựa chọn | 4 | 2 / 15 | Sắp xếp ×1, Chọn đáp án ×1, Phân loại ×1 | 18 | Còn 13 bài đang biên soạn |
| Âm nhạc | Môn lựa chọn | 4 | 3 / 8 | Sắp xếp ×2, Phân loại ×1, Ghép cặp ×1 | 22 | Còn 5 bài đang biên soạn |
| Mĩ thuật | Môn lựa chọn | 4 | 2 / 6 | Sắp xếp ×1, Ghép cặp ×1, Chọn đáp án ×1 | 13 | Còn 4 bài đang biên soạn |
| Giáo dục thể chất | Bắt buộc | 3 | 2 / 4 | Ghép cặp ×1, Chọn đáp án ×1 | 10 | Còn 2 bài đang biên soạn |
| Giáo dục quốc phòng và an ninh | Bắt buộc | 4 | 2 / 8 | Chọn đáp án ×2, Sắp xếp ×2 | 21 | Còn 6 bài đang biên soạn |
| Hoạt động trải nghiệm, hướng nghiệp | Hoạt động giáo dục bắt buộc | 4 | 1 / 8 | Chọn đáp án ×1, Ghép cặp ×1 | 9 | Còn 7 bài đang biên soạn |
| Nội dung giáo dục của địa phương | Bắt buộc | 0 | 0 / 0 | — | 0 | Không hỗ trợ: Nội dung do từng tỉnh, thành phố biên soạn và phê duyệt: Mirabi chưa có tài liệu của địa phương nên chưa có bài học. |
| Tiếng dân tộc thiểu số | Môn tự chọn | 0 | 0 / 0 | — | 0 | Không hỗ trợ: Tuỳ ngôn ngữ và điều kiện của từng trường: Mirabi chưa có bài học. |
| Ngoại ngữ 2 | Môn tự chọn | 0 | 0 / 0 | — | 0 | Không hỗ trợ: Tuỳ ngoại ngữ trường chọn: Mirabi chưa có bài học. |
| Chuyên đề học tập lựa chọn | Môn lựa chọn | 0 | 0 / 0 | — | 0 | Không hỗ trợ: Gắn với tổ hợp môn của từng trường: Mirabi chưa có bài học chuyên đề. |

### Lớp 11

16 môn/hoạt động có trong Mirabi trên 20 của chương trình · 42 bài sẵn sàng · 342 câu hỏi/nhiệm vụ đã soát

| Môn | Loại | Chương | Bài sẵn sàng / trong danh mục | Trò chơi (số bài dùng) | Câu hỏi | Trạng thái |
|---|---|---|---|---|---|---|
| Ngữ văn | Bắt buộc | 5 | 3 / 13 | Chọn đáp án ×2, Ghép cặp ×1 | 16 | Còn 10 bài đang biên soạn |
| Toán | Bắt buộc | 6 | 6 / 24 | Chọn đáp án ×4, Ghép cặp ×3 | 36 | Còn 18 bài đang biên soạn |
| Tiếng Anh | Bắt buộc | 4 | 4 / 12 | Chọn đáp án ×2, Việt → Anh ×1, Anh → Việt ×1, Sắp xếp ×1, Ghép cặp ×1 | 52 | Còn 8 bài đang biên soạn |
| Giáo dục kinh tế và pháp luật | Môn lựa chọn | 5 | 3 / 18 | Chọn đáp án ×3, Ghép cặp ×2, Phân loại ×1 | 32 | Còn 15 bài đang biên soạn |
| Lịch sử | Bắt buộc | 6 | 2 / 17 | Ghép cặp ×2, Sắp xếp ×1 | 10 | Còn 15 bài đang biên soạn |
| Địa lí | Môn lựa chọn | 6 | 3 / 16 | Ghép cặp ×1, Phân loại ×1, Chọn đáp án ×1 | 19 | Còn 13 bài đang biên soạn |
| Vật lí | Môn lựa chọn | 4 | 3 / 19 | Chọn đáp án ×2, Ghép cặp ×1, Phân loại ×1, Sắp xếp ×1 | 30 | Còn 16 bài đang biên soạn |
| Hoá học | Môn lựa chọn | 6 | 3 / 21 | Chọn đáp án ×3, Phân loại ×1 | 34 | Còn 18 bài đang biên soạn |
| Sinh học | Môn lựa chọn | 4 | 2 / 17 | Chọn đáp án ×2, Phân loại ×1, Sắp xếp ×1 | 30 | Còn 15 bài đang biên soạn |
| Tin học | Môn lựa chọn | 6 | 3 / 14 | Ghép cặp ×1, Chọn đáp án ×1, Lập trình ×1 | 14 | Còn 11 bài đang biên soạn |
| Công nghệ | Môn lựa chọn | 4 | 2 / 14 | Ghép cặp ×1, Phân loại ×1 | 13 | Còn 12 bài đang biên soạn |
| Âm nhạc | Môn lựa chọn | 4 | 2 / 8 | Ghép cặp ×2, Chọn đáp án ×1 | 11 | Còn 6 bài đang biên soạn |
| Mĩ thuật | Môn lựa chọn | 4 | 2 / 5 | Ghép cặp ×1, Sắp xếp ×1 | 7 | Còn 3 bài đang biên soạn |
| Giáo dục thể chất | Bắt buộc | 3 | 1 / 4 | Sắp xếp ×1, Chọn đáp án ×1 | 9 | Còn 3 bài đang biên soạn |
| Giáo dục quốc phòng và an ninh | Bắt buộc | 4 | 2 / 8 | Chọn đáp án ×2, Phân loại ×1, Ghép cặp ×1 | 23 | Còn 6 bài đang biên soạn |
| Hoạt động trải nghiệm, hướng nghiệp | Hoạt động giáo dục bắt buộc | 4 | 1 / 8 | Chọn đáp án ×1 | 6 | Còn 7 bài đang biên soạn |
| Nội dung giáo dục của địa phương | Bắt buộc | 0 | 0 / 0 | — | 0 | Không hỗ trợ: Nội dung do từng tỉnh, thành phố biên soạn và phê duyệt: Mirabi chưa có tài liệu của địa phương nên chưa có bài học. |
| Tiếng dân tộc thiểu số | Môn tự chọn | 0 | 0 / 0 | — | 0 | Không hỗ trợ: Tuỳ ngôn ngữ và điều kiện của từng trường: Mirabi chưa có bài học. |
| Ngoại ngữ 2 | Môn tự chọn | 0 | 0 / 0 | — | 0 | Không hỗ trợ: Tuỳ ngoại ngữ trường chọn: Mirabi chưa có bài học. |
| Chuyên đề học tập lựa chọn | Môn lựa chọn | 0 | 0 / 0 | — | 0 | Không hỗ trợ: Gắn với tổ hợp môn của từng trường: Mirabi chưa có bài học chuyên đề. |

### Lớp 12

16 môn/hoạt động có trong Mirabi trên 20 của chương trình · 44 bài sẵn sàng · 330 câu hỏi/nhiệm vụ đã soát

| Môn | Loại | Chương | Bài sẵn sàng / trong danh mục | Trò chơi (số bài dùng) | Câu hỏi | Trạng thái |
|---|---|---|---|---|---|---|
| Ngữ văn | Bắt buộc | 5 | 3 / 13 | Chọn đáp án ×2, Ghép cặp ×1 | 16 | Còn 10 bài đang biên soạn |
| Toán | Bắt buộc | 6 | 5 / 17 | Chọn đáp án ×4, Ghép cặp ×1 | 30 | Còn 12 bài đang biên soạn |
| Tiếng Anh | Bắt buộc | 4 | 4 / 13 | Chọn đáp án ×2, Sắp xếp ×1, Việt → Anh ×1, Anh → Việt ×1, Ghép cặp ×1 | 52 | Còn 9 bài đang biên soạn |
| Giáo dục kinh tế và pháp luật | Môn lựa chọn | 5 | 3 / 14 | Chọn đáp án ×3, Ghép cặp ×1, Sắp xếp ×1 | 23 | Còn 11 bài đang biên soạn |
| Lịch sử | Bắt buộc | 6 | 3 / 17 | Chọn đáp án ×2, Sắp xếp ×1 | 16 | Còn 14 bài đang biên soạn |
| Địa lí | Môn lựa chọn | 5 | 2 / 23 | Phân loại ×1, Chọn đáp án ×1 | 16 | Còn 21 bài đang biên soạn |
| Vật lí | Môn lựa chọn | 4 | 2 / 19 | Chọn đáp án ×2, Ghép cặp ×2 | 20 | Còn 17 bài đang biên soạn |
| Hoá học | Môn lựa chọn | 6 | 4 / 21 | Chọn đáp án ×3, Phân loại ×1, Sắp xếp ×1 | 33 | Còn 17 bài đang biên soạn |
| Sinh học | Môn lựa chọn | 5 | 3 / 23 | Sắp xếp ×2, Chọn đáp án ×2, Phân loại ×1 | 32 | Còn 20 bài đang biên soạn |
| Tin học | Môn lựa chọn | 6 | 3 / 14 | Ghép cặp ×2, Chọn đáp án ×1 | 13 | Còn 11 bài đang biên soạn |
| Công nghệ | Môn lựa chọn | 4 | 2 / 14 | Ghép cặp ×1, Sắp xếp ×1 | 8 | Còn 12 bài đang biên soạn |
| Âm nhạc | Môn lựa chọn | 4 | 3 / 7 | Chọn đáp án ×2, Ghép cặp ×1 | 14 | Còn 4 bài đang biên soạn |
| Mĩ thuật | Môn lựa chọn | 4 | 2 / 6 | Ghép cặp ×1, Chọn đáp án ×1 | 8 | Còn 4 bài đang biên soạn |
| Giáo dục thể chất | Bắt buộc | 3 | 2 / 5 | Sắp xếp ×1, Chọn đáp án ×1 | 10 | Còn 3 bài đang biên soạn |
| Giáo dục quốc phòng và an ninh | Bắt buộc | 4 | 2 / 9 | Chọn đáp án ×2, Phân loại ×1, Sắp xếp ×1 | 25 | Còn 7 bài đang biên soạn |
| Hoạt động trải nghiệm, hướng nghiệp | Hoạt động giáo dục bắt buộc | 4 | 1 / 8 | Chọn đáp án ×1, Phân loại ×1 | 14 | Còn 7 bài đang biên soạn |
| Nội dung giáo dục của địa phương | Bắt buộc | 0 | 0 / 0 | — | 0 | Không hỗ trợ: Nội dung do từng tỉnh, thành phố biên soạn và phê duyệt: Mirabi chưa có tài liệu của địa phương nên chưa có bài học. |
| Tiếng dân tộc thiểu số | Môn tự chọn | 0 | 0 / 0 | — | 0 | Không hỗ trợ: Tuỳ ngôn ngữ và điều kiện của từng trường: Mirabi chưa có bài học. |
| Ngoại ngữ 2 | Môn tự chọn | 0 | 0 / 0 | — | 0 | Không hỗ trợ: Tuỳ ngoại ngữ trường chọn: Mirabi chưa có bài học. |
| Chuyên đề học tập lựa chọn | Môn lựa chọn | 0 | 0 / 0 | — | 0 | Không hỗ trợ: Gắn với tổ hợp môn của từng trường: Mirabi chưa có bài học chuyên đề. |

