// Curated, source-backed context. No network requests or paid lookup during generation.
// Match only the subject, never audience/tone/creative settings.
export function topicReferences(topic: unknown): Array<{subject:string;source:string;facts:string[]}> {
  if(typeof topic!=='string')return [];
  const text=topic.normalize('NFC');
  if(!/kardashev|(?:nền\s+văn\s+minh\s+(?:cấp|loại)\s*(?:\d+|[ivx]+))|(?:(?:type|level)\s*(?:\d+|[ivx]+)\s+civili[sz]ation)|(?:civili[sz]ation\s+(?:type|level)\s*(?:\d+|[ivx]+))/iu.test(text))return [];
  return [{
    subject:'Thang phân loại nền văn minh theo năng lượng (Kardashev)',
    source:'https://technosearch.seti.org/wp-content/uploads/2018-09/Kardashev_CTA102.pdf',
    facts:[
      'Bài Transmission of Information by Extraterrestrial Civilizations của N. S. Kardashev (1964) phân loại nền văn minh theo mức tiêu thụ/khai thác năng lượng, không theo tâm lý, tự nhận thức, thế hệ con người hay các cấp độ AI.',
      'Thang gốc trình bày ba loại I, II, III: các quy mô năng lượng hành tinh, sao chủ và thiên hà. Không gọi các loại này là các thế hệ con người.',
      'Không có loại VII trong thang gốc. Cấp cao hơn III trong các cách nói mở rộng phải được giới thiệu là giả thuyết hoặc diễn giải khoa học viễn tưởng; không có định nghĩa thống nhất để khẳng định cấp VII là một loại trí tuệ đã được khoa học xác nhận.',
      'Nếu người dùng hỏi cấp 7, cần giải thích giới hạn của thuật ngữ trước; chỉ mô tả khả năng tưởng tượng với điều kiện rõ ràng. Không tự đặt tên Trí tuệ Tổng hợp siêu cấp cho nó.'
    ]
  }];
}
