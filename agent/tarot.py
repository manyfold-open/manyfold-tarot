#!/usr/bin/env python3
"""Tarot draws for the chat reader.

The deck (78 cards, upright and reversed keywords, zh and en) and the four
three-card spreads come from AI Tarot's source (github.com/manyfold-open/
manyfold-tarot, MIT: src/shared/tarot/deck.ts and spreads.ts), exported to
deck.json. Supports Traditional Chinese (zh-Hant), Simplified Chinese (zh-Hans,
with zh as backward-compatible alias), and English (en).

  python3 tarot.py spreads [--lang zh-Hant|zh-Hans|zh|en]
  python3 tarot.py draw <current|decision|next-step|weekly-review> [--lang zh-Hant|zh-Hans|zh|en]
  python3 tarot.py card <name> [--lang zh-Hant|zh-Hans|zh|en]

The card art (cards.zip: the site's public/cards, resized to JPEG, each also
turned upside down for a reversed draw) is unpacked on first use.
"""

import argparse
import datetime
import json
import os
import secrets
import shutil
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_LOG = os.path.expanduser('~/.cache/tarot/draws.jsonl')
SLOTS = ['situation', 'hidden', 'guidance']
LANG_CHOICES = ['zh-Hant', 'zh-Hans', 'zh', 'en']
# Manyfold sends a workspace file after the reply text when the reply links to
# it (apps/api/src/modules/channels/workspace-file-refs.ts). Narra shows a fenced
# block's opening line as nothing (chat-markdown.tsx splitFencedCode), so the
# references ride there unseen.
IMAGE_REF = '![]({})'

# Phrase-level Simplified -> Traditional overrides (applied longest-first) to avoid
# one-to-many homograph errors such as 皇后 vs 最後, 干擾 vs 乾淨, 聯繫 vs 關係, 收穫 vs 無獲.
ZH_HANT_PHRASES = (
    ('三里桥', '三里橋'),
    ('占上风', '佔上風'),
    ('倒吊人', '倒吊人'),
    ('一片云', '一片雲'),
    ('了解', '了解'),
    ('云开', '雲開'),
    ('云朵', '雲朵'),
    ('千里', '千里'),
    ('反复', '反覆'),
    ('发生', '發生'),
    ('发现', '發現'),
    ('发觉', '發覺'),
    ('周围', '周圍'),
    ('一周', '一週'),
    ('下周', '下週'),
    ('本周', '本週'),
    ('每周', '每週'),
    ('这周', '這週'),
    ('复盘', '復盤'),
    ('复杂', '複雜'),
    ('修复', '修復'),
    ('恢复', '恢復'),
    ('干净', '乾淨'),
    ('干脆', '乾脆'),
    ('干扰', '干擾'),
    ('路未干', '路未乾'),
    ('卷入', '捲入'),
    ('卷进', '捲進'),
    ('十斗', '十斗'),
    ('御守', '御守'),
    ('收获', '收穫'),
    ('晓发', '曉發'),
    ('欲望', '慾望'),
    ('独占', '獨佔'),
    ('疗愈', '療癒'),
    ('皇后', '皇后'),
    ('联系', '聯繫'),
    ('计划', '計劃'),
    ('规划', '規劃'),
    ('划掉', '劃掉'),
    ('划算', '划算'),
    ('迂回', '迂迴'),
    ('重复', '重複'),
)

ZH_HANT_CHARS = {
    '万': '萬', '与': '與', '专': '專', '业': '業', '东': '東', '丝': '絲', '丢': '丟',
    '两': '兩', '严': '嚴', '丧': '喪', '个': '個', '临': '臨', '为': '為', '举': '舉',
    '么': '麼', '义': '義', '乌': '烏', '乐': '樂', '习': '習', '乡': '鄉', '书': '書',
    '买': '買', '乱': '亂', '争': '爭', '于': '於', '亏': '虧', '云': '雲', '亚': '亞',
    '产': '產', '亲': '親', '亵': '褻', '亿': '億', '仅': '僅', '仆': '僕', '从': '從',
    '仑': '崙', '仓': '倉', '仪': '儀', '们': '們', '价': '價', '众': '眾', '优': '優',
    '会': '會', '伟': '偉', '传': '傳', '伤': '傷', '伦': '倫', '伪': '偽', '体': '體',
    '余': '餘', '佣': '傭', '侠': '俠', '侣': '侶', '侦': '偵', '侧': '側', '侨': '僑',
    '俩': '倆', '债': '債', '倾': '傾', '偿': '償', '储': '儲', '儿': '兒', '兑': '兌',
    '党': '黨', '兰': '蘭', '关': '關', '兴': '興', '养': '養', '兽': '獸', '内': '內',
    '冈': '岡', '册': '冊', '写': '寫', '军': '軍', '农': '農', '冯': '馮', '冲': '衝',
    '决': '決', '况': '況', '净': '淨', '准': '準', '凉': '涼', '减': '減', '几': '幾',
    '凤': '鳳', '凭': '憑', '凯': '凱', '击': '擊', '凿': '鑿', '划': '劃', '刘': '劉',
    '则': '則', '刚': '剛', '创': '創', '删': '刪', '别': '別', '剑': '劍', '剥': '剝',
    '剧': '劇', '劝': '勸', '办': '辦', '务': '務', '动': '動', '劲': '勁', '劳': '勞',
    '势': '勢', '勋': '勳', '医': '醫', '华': '華', '协': '協', '单': '單', '卖': '賣',
    '卢': '盧', '卫': '衛', '却': '卻', '卷': '捲', '厂': '廠', '厅': '廳', '历': '歷',
    '压': '壓', '厌': '厭', '厕': '廁', '县': '縣', '参': '參', '双': '雙', '发': '發',
    '变': '變', '叙': '敘', '叠': '疊', '叶': '葉', '号': '號', '叹': '嘆', '后': '後',
    '吓': '嚇', '吗': '嗎', '启': '啟', '吴': '吳', '员': '員', '呜': '嗚', '周': '週',
    '响': '響', '哑': '啞', '唤': '喚', '喷': '噴', '团': '團', '园': '園', '围': '圍',
    '国': '國', '图': '圖', '圆': '圓', '圣': '聖', '场': '場', '坏': '壞', '坚': '堅',
    '坛': '壇', '坝': '壩', '坞': '塢', '坟': '墳', '坠': '墜', '块': '塊', '垒': '壘',
    '垦': '墾', '垫': '墊', '执': '執', '堕': '墮', '声': '聲', '壳': '殼', '壶': '壺',
    '处': '處', '备': '備', '复': '復', '够': '夠', '头': '頭', '夸': '誇', '夹': '夾',
    '夺': '奪', '奋': '奮', '奖': '獎', '奥': '奧', '妇': '婦', '妈': '媽', '娱': '娛',
    '孙': '孫', '学': '學', '宁': '寧', '宫': '宮', '宝': '寶', '实': '實', '宠': '寵',
    '审': '審', '宪': '憲', '宽': '寬', '宾': '賓', '对': '對', '寻': '尋', '导': '導',
    '寿': '壽', '将': '將', '尔': '爾', '尘': '塵', '尝': '嘗', '尽': '盡', '层': '層',
    '属': '屬', '屡': '屢', '岁': '歲', '岂': '豈', '岗': '崗', '岛': '島', '岭': '嶺',
    '岳': '嶽', '峡': '峽', '币': '幣', '帅': '帥', '师': '師', '帐': '帳', '带': '帶',
    '帧': '幀', '帮': '幫', '干': '乾', '并': '並', '广': '廣', '庄': '莊', '庆': '慶',
    '库': '庫', '应': '應', '庙': '廟', '废': '廢', '开': '開', '异': '異', '弃': '棄',
    '张': '張', '弥': '彌', '弯': '彎', '弹': '彈', '强': '強', '归': '歸', '当': '當',
    '录': '錄', '彻': '徹', '径': '徑', '忆': '憶', '忧': '憂', '态': '態', '怀': '懷',
    '总': '總', '恋': '戀', '恒': '恆', '恶': '惡', '恼': '惱', '悬': '懸', '惊': '驚',
    '惧': '懼', '惨': '慘', '惫': '憊', '惯': '慣', '愿': '願', '懒': '懶', '戏': '戲',
    '战': '戰', '户': '戶', '扑': '撲', '扩': '擴', '扫': '掃', '扬': '揚', '扰': '擾',
    '护': '護', '报': '報', '担': '擔', '拟': '擬', '拥': '擁', '择': '擇', '挂': '掛',
    '挡': '擋', '挣': '掙', '挤': '擠', '挥': '揮', '损': '損', '换': '換', '据': '據',
    '搁': '擱', '摆': '擺', '摇': '搖', '摊': '攤', '撑': '撐', '敌': '敵', '敛': '斂',
    '数': '數', '断': '斷', '无': '無', '旧': '舊', '时': '時', '显': '顯', '晒': '曬',
    '晓': '曉', '暂': '暫', '术': '術', '机': '機', '杀': '殺', '杂': '雜', '权': '權',
    '杆': '桿', '条': '條', '来': '來', '杨': '楊', '松': '鬆', '极': '極', '构': '構',
    '标': '標', '栋': '棟', '栏': '欄', '树': '樹', '样': '樣', '桥': '橋', '桩': '樁',
    '梦': '夢', '检': '檢', '楼': '樓', '横': '橫', '樱': '櫻', '欢': '歡', '欧': '歐',
    '残': '殘', '气': '氣', '汇': '匯', '汉': '漢', '汤': '湯', '沟': '溝', '没': '沒',
    '泽': '澤', '洁': '潔', '浅': '淺', '浇': '澆', '测': '測', '济': '濟', '浓': '濃',
    '涌': '湧', '涛': '濤', '净': '淨', '渊': '淵', '渐': '漸', '渔': '漁', '渗': '滲',
    '温': '溫', '湾': '灣', '湿': '濕', '滤': '濾', '滥': '濫', '滨': '濱', '潜': '潛',
    '灯': '燈', '灵': '靈', '灾': '災', '炉': '爐', '炖': '燉', '点': '點', '炼': '煉',
    '烟': '煙', '烦': '煩', '烧': '燒', '热': '熱', '烛': '燭', '爱': '愛', '爷': '爺',
    '牵': '牽', '牺': '犧', '状': '狀', '犹': '猶', '独': '獨', '狭': '狹', '献': '獻',
    '玛': '瑪', '环': '環', '现': '現', '珑': '瓏', '琐': '瑣', '电': '電', '画': '畫',
    '畅': '暢', '畴': '疇', '疗': '療', '盘': '盤', '着': '著', '瞒': '瞞', '矿': '礦',
    '码': '碼', '确': '確', '碍': '礙', '礼': '禮', '离': '離', '种': '種', '积': '積',
    '称': '稱', '稳': '穩', '穷': '窮', '竞': '競', '笔': '筆', '简': '簡', '篮': '籃',
    '筛': '篩', '签': '籤', '类': '類', '紧': '緊', '纠': '糾', '红': '紅', '约': '約',
    '级': '級', '纪': '紀', '纯': '純', '纸': '紙', '纷': '紛', '细': '細', '织': '織',
    '终': '終', '组': '組', '经': '經', '结': '結', '绕': '繞', '绘': '繪', '给': '給',
    '绝': '絕', '统': '統', '继': '繼', '绩': '績', '绪': '緒', '续': '續', '维': '維',
    '综': '綜', '绿': '綠', '缓': '緩', '编': '編', '缘': '緣', '缚': '縛', '缝': '縫',
    '缩': '縮', '纵': '縱', '线': '線', '练': '練', '绑': '綁', '网': '網', '罗': '羅',
    '罚': '罰', '羡': '羨', '联': '聯', '聪': '聰', '胜': '勝', '脱': '脫', '脸': '臉',
    '舍': '捨', '节': '節', '苍': '蒼', '苏': '蘇', '荣': '榮', '药': '藥', '获': '獲',
    '营': '營', '萧': '蕭', '萨': '薩', '蓝': '藍', '茧': '繭', '荫': '蔭', '虑': '慮',
    '虫': '蟲', '虽': '雖', '蜡': '蠟', '补': '補', '装': '裝', '里': '裡', '观': '觀',
    '规': '規', '觅': '覓', '视': '視', '觉': '覺', '计': '計', '订': '訂', '认': '認',
    '讨': '討', '让': '讓', '训': '訓', '议': '議', '讯': '訊', '记': '記', '讲': '講',
    '许': '許', '论': '論', '设': '設', '访': '訪', '证': '證', '评': '評', '识': '識',
    '诉': '訴', '词': '詞', '译': '譯', '试': '試', '诗': '詩', '诚': '誠', '话': '話',
    '该': '該', '详': '詳', '语': '語', '误': '誤', '诱': '誘', '说': '說', '请': '請',
    '诸': '諸', '读': '讀', '课': '課', '谁': '誰', '调': '調', '谈': '談', '谋': '謀',
    '谓': '謂', '谜': '謎', '谢': '謝', '谨': '謹', '贝': '貝', '负': '負', '贡': '貢',
    '财': '財', '责': '責', '贤': '賢', '败': '敗', '货': '貨', '质': '質', '贪': '貪',
    '贫': '貧', '购': '購', '贯': '貫', '贴': '貼', '贵': '貴', '贷': '貸', '费': '費',
    '贺': '賀', '贼': '賊', '资': '資', '赏': '賞', '赔': '賠', '赖': '賴', '赚': '賺',
    '赛': '賽', '赞': '讚', '赠': '贈', '赢': '贏', '赶': '趕', '跃': '躍', '车': '車',
    '轨': '軌', '转': '轉', '轮': '輪', '软': '軟', '轴': '軸', '轰': '轟', '轻': '輕',
    '载': '載', '较': '較', '辅': '輔', '辆': '輛', '辈': '輩', '辉': '輝', '输': '輸',
    '辙': '轍', '辞': '辭', '辩': '辯', '边': '邊', '达': '達', '迁': '遷', '过': '過',
    '迈': '邁', '迎': '迎', '运': '運', '还': '還', '这': '這', '进': '進', '远': '遠',
    '违': '違', '连': '連', '迟': '遲', '迹': '跡', '适': '適', '选': '選', '逊': '遜',
    '递': '遞', '遗': '遺', '遥': '遙', '邻': '鄰', '郁': '鬱', '采': '採', '释': '釋',
    '鉴': '鑒', '针': '針', '钉': '釘', '钓': '釣', '钟': '鐘', '钢': '鋼', '钱': '錢',
    '铁': '鐵', '钻': '鑽', '银': '銀', '铺': '鋪', '链': '鏈', '销': '銷', '锁': '鎖',
    '锅': '鍋', '锋': '鋒', '错': '錯', '锥': '錐', '锦': '錦', '键': '鍵', '镇': '鎮',
    '镜': '鏡', '长': '長', '门': '門', '闪': '閃', '闭': '閉', '问': '問', '闲': '閒',
    '间': '間', '闷': '悶', '闹': '鬧', '闻': '聞', '阅': '閱', '阔': '闊', '队': '隊',
    '阳': '陽', '阴': '陰', '阵': '陣', '阶': '階', '际': '際', '陆': '陸', '陈': '陳',
    '险': '險', '随': '隨', '隐': '隱', '难': '難', '雾': '霧', '静': '靜', '韧': '韌',
    '顶': '頂', '项': '項', '顺': '順', '须': '須', '顽': '頑', '顾': '顧', '顿': '頓',
    '预': '預', '领': '領', '颇': '頗', '频': '頻', '颗': '顆', '题': '題', '额': '額',
    '颜': '顏', '风': '風', '飘': '飄', '飞': '飛', '饭': '飯', '饮': '飲', '饰': '飾',
    '饱': '飽', '饼': '餅', '馆': '館', '馈': '饋', '马': '馬', '驱': '驅', '驶': '駛',
    '驻': '駐', '驾': '駕', '验': '驗', '骑': '騎', '骗': '騙', '骤': '驟', '鱼': '魚',
    '鲁': '魯', '鲜': '鮮', '鸟': '鳥', '鸡': '雞', '鸣': '鳴', '鸭': '鴨', '黄': '黃',
    '齐': '齊', '龙': '龍', '龟': '龜', '听': '聽', '范': '範', '系': '係', '丰': '豐',
    '见': '見', '满': '滿', '滞': '滯',
}
_PHRASES_BY_LEN = sorted(ZH_HANT_PHRASES, key=lambda pair: -len(pair[0]))


def to_zh_hant(text):
    """Convert Simplified Chinese tarot text to pure Traditional Chinese."""
    out = []
    i = 0
    n = len(text)
    while i < n:
        for src, dst in _PHRASES_BY_LEN:
            if text.startswith(src, i):
                out.append(dst)
                i += len(src)
                break
        else:
            ch = text[i]
            out.append(ZH_HANT_CHARS.get(ch, ch))
            i += 1
    return ''.join(out)


def normalize_lang(lang):
    """Map --lang input (including legacy 'zh') to canonical zh-Hant, zh-Hans, or en."""
    if lang == 'zh':
        return 'zh-Hans'
    return lang


def localize_text(text, lang):
    if lang == 'zh-Hant':
        return to_zh_hant(text)
    return text


def data_lang_key(lang):
    return 'zh' if lang in ('zh-Hant', 'zh-Hans') else 'en'


def image_line(paths):
    return '```' + ' '.join(IMAGE_REF.format(p) for p in paths) + '```'


def unpacked(name):
    target = os.path.join(HERE, name)
    zip_path = os.path.join(HERE, f'{name}.zip')
    if not os.path.isdir(target) and os.path.isfile(zip_path):
        tmp = tempfile.mkdtemp(dir=HERE)
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(tmp)
        try:
            os.rename(os.path.join(tmp, name), target)
        except OSError:
            pass
        shutil.rmtree(tmp, ignore_errors=True)
    return name


def images(paths):
    print('Images: end your reply with the next line, exactly as it is.')
    print(image_line(paths))


def data():
    with open(os.path.join(HERE, 'deck.json'), encoding='utf-8') as f:
        return json.load(f)


def localize_spread(raw, lang):
    if lang != 'zh-Hant':
        return raw
    localized = {
        'id': raw['id'],
        'title': to_zh_hant(raw['title']),
        'description': to_zh_hant(raw['description']),
        'instruction': to_zh_hant(raw['instruction']),
        'example': to_zh_hant(raw['example']),
        'guidance': {k: to_zh_hant(v) for k, v in raw['guidance'].items()},
        'slots': {
            k: {'title': to_zh_hant(v['title']), 'prompt': to_zh_hant(v['prompt'])}
            for k, v in raw['slots'].items()
        },
    }
    if 'quickFollowUps' in raw:
        localized['quickFollowUps'] = [to_zh_hant(q) for q in raw['quickFollowUps']]
    return localized


def spread(sid, lang):
    dkey = data_lang_key(lang)
    found = next((s for s in data()['spreads'][dkey] if s['id'] == sid), None)
    if not found:
        sys.exit(f'no spread "{sid}": run spreads')
    return localize_spread(found, lang)


def cmd_spreads(args):
    lang = normalize_lang(args.lang)
    dkey = data_lang_key(lang)
    for raw in data()['spreads'][dkey]:
        s = localize_spread(raw, lang)
        slots = ' / '.join(s['slots'][k]['title'] for k in SLOTS)
        print(f"- {s['id']}: {s['title']}: {s['description']} [{slots}]")


def cmd_draw(args):
    lang = normalize_lang(args.lang)
    dkey = data_lang_key(lang)
    deck = data()['deck']
    s = spread(args.spread, lang)
    picks = secrets.SystemRandom().sample(range(len(deck)), 3)
    cards = [(deck[i], secrets.randbelow(2) == 1) for i in picks]
    when = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')
    log_path = os.path.expanduser(os.environ.get('TAROT_DRAW_LOG', DEFAULT_LOG))
    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    with open(log_path, 'a', encoding='utf-8') as f:
        f.write(json.dumps({'at': when, 'spread': args.spread, 'lang': lang, 'cards': [[c['id'], r] for c, r in cards]}) + '\n')
    is_zh = dkey == 'zh'
    print(f"Drawn {when}. These three cards and their orientations are fixed for this question: read exactly them, never swap, add, drop or re-draw one.")
    print(f"Spread: {s['title']}: {s['instruction']}")
    for slot, (card, reversed_) in zip(SLOTS, cards):
        side = 'reversed' if reversed_ else 'upright'
        cname = localize_text(card['name'][dkey], lang)
        ckeywords = localize_text(card[side][dkey], lang)
        label = f"{cname}{'（逆位）' if is_zh and reversed_ else '（正位）' if is_zh else f' ({side})'}"
        print(f"- {s['slots'][slot]['title']}: {label}. Traditional keywords: {ckeywords}")
    g = s['guidance']
    print(f"How to answer them: {g['response']}")
    print(f"Actions: {g['actions']}")
    print(f"Question to leave them with: {g['reflection']}")
    if g.get('followUp'):
        print(f"For follow-ups: {g['followUp']}")
    folder = unpacked('cards')
    images([f"{folder}/{card['id']}{'-r' if reversed_ else ''}.jpg" for card, reversed_ in cards])


def cmd_card(args):
    q = ''.join(args.name).lower().replace(' ', '')
    lang = normalize_lang(args.lang) if args.lang else None
    for card in data()['deck']:
        zh_hans = card['name']['zh']
        zh_hant = to_zh_hant(zh_hans)
        names = [card['name']['en'].lower().replace(' ', ''), zh_hans, zh_hant, card['id']]
        if q in names or any(q and q in n for n in names):
            if lang == 'zh-Hant':
                print(zh_hant)
                print(f"正位：{to_zh_hant(card['upright']['zh'])}")
                print(f"逆位：{to_zh_hant(card['reversed']['zh'])}")
            elif lang == 'zh-Hans':
                print(zh_hans)
                print(f"正位：{card['upright']['zh']}")
                print(f"逆位：{card['reversed']['zh']}")
            elif lang == 'en':
                print(card['name']['en'])
                print(f"Upright: {card['upright']['en']}")
                print(f"Reversed: {card['reversed']['en']}")
            else:
                print(f"{card['name']['en']} / {zh_hant} / {zh_hans}")
                print(f"Upright: {card['upright']['en']} / {to_zh_hant(card['upright']['zh'])} / {card['upright']['zh']}")
                print(f"Reversed: {card['reversed']['en']} / {to_zh_hant(card['reversed']['zh'])} / {card['reversed']['zh']}")
            print('If they asked to see the card:')
            images([f"{unpacked('cards')}/{card['id']}.jpg"])
            return
    sys.exit(f'no card named "{" ".join(args.name)}"')


def main():
    ap = argparse.ArgumentParser(description='Tarot draws')
    sub = ap.add_subparsers(dest='cmd', required=True)
    s = sub.add_parser('spreads')
    s.add_argument('--lang', choices=LANG_CHOICES, default='en')
    s.set_defaults(fn=cmd_spreads)
    s = sub.add_parser('draw')
    s.add_argument('spread', choices=['current', 'decision', 'next-step', 'weekly-review'])
    s.add_argument('--lang', choices=LANG_CHOICES, default='en')
    s.set_defaults(fn=cmd_draw)
    s = sub.add_parser('card')
    s.add_argument('name', nargs='+')
    s.add_argument('--lang', choices=LANG_CHOICES, default=None)
    s.set_defaults(fn=cmd_card)
    args = ap.parse_args()
    args.fn(args)


if __name__ == '__main__':
    main()
