/* Lesson content. v: expected vowels per syllable ('y' = French U, 'u' = OU, 'i' = I, '*' = not checked). r: check the R. */
const LESSONS = [
  {
    id: 'u', title: 'Le U', sub: 'tu · vu · rue', color: '#8b6cff', soft: '#e9e3ff', emoji: '😗',
    tip: {
      mouth: 'iy',
      title: 'The French U',
      lines: [
        'Say <b>“eee”</b> (like in <i>see</i>).',
        'Freeze your tongue right there. 🧊',
        'Now push your lips into a <b>tiny kiss</b>. 😗',
        'That’s U! It’s <b>not</b> “oo” and <b>not</b> “you”.',
      ],
      model: 'u',
    },
    steps: [
      { title: 'Find the sound', items: [
        { kind: 'sustain', say: 'uuuu', model: 'u', target: 'y', hint: 'Hold it for 2 seconds' },
        { kind: 'glide', say: 'iiii → uuuu', model: 'i… u', target: 'iy', hint: 'Start with I, then just round your lips. Don’t move your tongue!' },
        { kind: 'sustain', say: 'uuuu', model: 'u', target: 'y', hint: 'One more — steady and round' },
      ] },
      { title: 'Tiny words', items: [
        { kind: 'word', w: 'tu', v: ['y'], en: 'you' },
        { kind: 'word', w: 'vu', v: ['y'], en: 'seen' },
        { kind: 'word', w: 'lu', v: ['y'], en: 'read' },
        { kind: 'word', w: 'du', v: ['y'], en: 'some' },
        { kind: 'word', w: 'su', v: ['y'], en: 'known' },
      ] },
      { title: 'U or OU?', items: [
        { kind: 'pair', a: { w: 'tu', v: ['y'], en: 'you' }, b: { w: 'tout', v: ['u'], en: 'all' } },
        { kind: 'pair', a: { w: 'vu', v: ['y'], en: 'seen' }, b: { w: 'vous', v: ['u'], en: 'you (formal)' } },
        { kind: 'pair', a: { w: 'lu', v: ['y'], en: 'read' }, b: { w: 'loup', v: ['u'], en: 'wolf' } },
        { kind: 'pair', a: { w: 'du', v: ['y'], en: 'some' }, b: { w: 'doux', v: ['u'], en: 'soft' } },
      ] },
      { title: 'Real words', items: [
        { kind: 'word', w: 'salut', syl: ['sa', 'lut'], v: ['*', 'y'], en: 'hi!' },
        { kind: 'word', w: 'une', v: ['y'], en: 'a / one' },
        { kind: 'word', w: 'jupe', v: ['y'], en: 'skirt' },
        { kind: 'word', w: 'musique', syl: ['mu', 'sique'], v: ['y', 'i'], en: 'music' },
        { kind: 'word', w: 'voiture', syl: ['voi', 'ture'], v: ['*', 'y'], en: 'car' },
      ] },
      { title: 'Little sentences', items: [
        { kind: 'sentence', s: 'Tu as vu ?', focus: ['tu', 'vu'], en: 'Did you see?' },
        { kind: 'sentence', s: 'Salut, tu vas bien ?', focus: ['salut', 'tu'], en: 'Hi, are you ok?' },
        { kind: 'sentence', s: 'J’ai lu une histoire.', focus: ['lu', 'une'], en: 'I read a story.' },
      ] },
    ],
  },
  {
    id: 'i', title: 'Le I', sub: 'si · lit · midi', color: '#ff7aa8', soft: '#ffe3ee', emoji: '😁',
    tip: {
      mouth: 'i',
      title: 'The French I',
      lines: [
        'Big <b>smile</b>! 😁',
        'Tongue <b>high and tight</b>, close to the roof of your mouth.',
        'Short and sharp, like a little mouse: <b>“ee!”</b> 🐭',
        'English <i>“ih”</i> (as in <i>sit</i>) is too relaxed. French I is always the tense one.',
      ],
      model: 'i',
    },
    steps: [
      { title: 'Find the sound', items: [
        { kind: 'sustain', say: 'iiii', model: 'i', target: 'i', hint: 'Smile and hold it for 2 seconds' },
        { kind: 'sustain', say: 'iiii', model: 'i', target: 'i', hint: 'Even tighter — big smile' },
      ] },
      { title: 'Tiny words', items: [
        { kind: 'word', w: 'si', v: ['i'], en: 'if / so' },
        { kind: 'word', w: 'lit', v: ['i'], en: 'bed' },
        { kind: 'word', w: 'dit', v: ['i'], en: 'said' },
        { kind: 'word', w: 'vie', v: ['i'], en: 'life' },
        { kind: 'word', w: 'il', v: ['i'], en: 'he' },
      ] },
      { title: 'I or U?', items: [
        { kind: 'pair', a: { w: 'lit', v: ['i'], en: 'bed' }, b: { w: 'lu', v: ['y'], en: 'read' } },
        { kind: 'pair', a: { w: 'si', v: ['i'], en: 'if' }, b: { w: 'su', v: ['y'], en: 'known' } },
        { kind: 'pair', a: { w: 'vie', v: ['i'], en: 'life' }, b: { w: 'vu', v: ['y'], en: 'seen' } },
        { kind: 'pair', a: { w: 'dit', v: ['i'], en: 'said' }, b: { w: 'du', v: ['y'], en: 'some' } },
      ] },
      { title: 'Real words', items: [
        { kind: 'word', w: 'midi', syl: ['mi', 'di'], v: ['i', 'i'], en: 'noon' },
        { kind: 'word', w: 'ici', syl: ['i', 'ci'], v: ['i', 'i'], en: 'here' },
        { kind: 'word', w: 'fini', syl: ['fi', 'ni'], v: ['i', 'i'], en: 'finished' },
        { kind: 'word', w: 'ami', syl: ['a', 'mi'], v: ['*', 'i'], en: 'friend' },
        { kind: 'word', w: 'petit', syl: ['pe', 'tit'], v: ['*', 'i'], en: 'small' },
      ] },
      { title: 'Little sentences', items: [
        { kind: 'sentence', s: 'Il lit ici.', focus: ['il', 'lit', 'ici'], en: 'He reads here.' },
        { kind: 'sentence', s: 'Mimi a fini.', focus: ['mimi', 'fini'], en: 'Mimi is done.' },
        { kind: 'sentence', s: 'Merci, mon ami !', focus: ['merci', 'ami'], en: 'Thanks, my friend!' },
      ] },
    ],
  },
  {
    id: 'r', title: 'Le R', sub: 'rat · riz · rouge', color: '#ff9f43', soft: '#fff0dc', emoji: '🦁',
    tip: {
      mouth: 'r',
      title: 'The French R',
      lines: [
        'Put the <b>tip of your tongue down</b>, behind your bottom teeth. 👇',
        'Now make a <b>soft gargle</b> at the back of your throat. 🫧',
        'Like the end of Scottish <i>“loch”</i>, but with your voice on.',
        '<b>Don’t curl your tongue</b> (that’s the English R) and <b>don’t roll it</b> (that’s Spanish).',
      ],
      model: 'ra',
    },
    steps: [
      { title: 'Find the sound', items: [
        { kind: 'rsustain', say: 'rrrrr', model: 'r', hint: 'Gentle gargle for 2 seconds. Tongue tip stays down!' },
        { kind: 'rsustain', say: 'rrrrr', model: 'r', hint: 'Again — soft and steady, like a purring cat 🐈' },
      ] },
      { title: 'R + a vowel', items: [
        { kind: 'word', w: 'ra', r: true, en: '' },
        { kind: 'word', w: 'ri', r: true, v: ['i'], en: '' },
        { kind: 'word', w: 'rou', r: true, v: ['u'], en: '' },
        { kind: 'word', w: 'ru', r: true, v: ['y'], en: '' },
      ] },
      { title: 'Tiny words', items: [
        { kind: 'word', w: 'rat', r: true, en: 'rat' },
        { kind: 'word', w: 'riz', r: true, v: ['i'], en: 'rice' },
        { kind: 'word', w: 'rue', r: true, v: ['y'], en: 'street' },
        { kind: 'word', w: 'roue', r: true, v: ['u'], en: 'wheel' },
        { kind: 'word', w: 'rose', r: true, en: 'pink / rose' },
      ] },
      { title: 'R in the middle & end', items: [
        { kind: 'word', w: 'Paris', syl: ['Pa', 'ris'], r: true, v: ['*', 'i'], en: 'Paris' },
        { kind: 'word', w: 'merci', syl: ['mer', 'ci'], r: true, v: ['*', 'i'], en: 'thank you' },
        { kind: 'word', w: 'pour', r: true, v: ['u'], en: 'for' },
        { kind: 'word', w: 'mer', r: true, en: 'sea' },
        { kind: 'word', w: 'rire', r: true, v: ['i'], en: 'to laugh' },
      ] },
      { title: 'Little sentences', items: [
        { kind: 'sentence', s: 'Le rat rouge.', focus: ['rat', 'rouge'], en: 'The red rat.' },
        { kind: 'sentence', s: 'Il rit à Paris.', focus: ['rit', 'paris'], en: 'He laughs in Paris.' },
        { kind: 'sentence', s: 'Merci pour le riz !', focus: ['merci', 'pour', 'riz'], en: 'Thanks for the rice!' },
      ] },
    ],
  },
  {
    id: 'mix', title: 'Le grand mix', sub: 'U · OU · I · R', color: '#2ec4b6', soft: '#dcf7f4', emoji: '🎉',
    tip: {
      mouth: 'mix',
      title: 'Put it all together',
      lines: [
        '<b>I</b> = big smile 😁',
        '<b>U</b> = smile tongue + tiny kiss 😗',
        '<b>OU</b> = tongue back + round lips, like blowing a candle 🕯️',
        '<b>R</b> = soft gargle, tongue tip down 🦁',
      ],
      model: 'i, u, ou',
    },
    steps: [
      { title: 'Three in a row', items: [
        { kind: 'triple', words: [{ w: 'vie', v: ['i'], en: 'life' }, { w: 'vu', v: ['y'], en: 'seen' }, { w: 'vous', v: ['u'], en: 'you' }] },
        { kind: 'triple', words: [{ w: 'lit', v: ['i'], en: 'bed' }, { w: 'lu', v: ['y'], en: 'read' }, { w: 'loup', v: ['u'], en: 'wolf' }] },
      ] },
      { title: 'Tricky pairs', items: [
        { kind: 'pair', a: { w: 'rue', r: true, v: ['y'], en: 'street' }, b: { w: 'roue', r: true, v: ['u'], en: 'wheel' } },
        { kind: 'pair', a: { w: 'riz', r: true, v: ['i'], en: 'rice' }, b: { w: 'rue', r: true, v: ['y'], en: 'street' } },
      ] },
      { title: 'Real words', items: [
        { kind: 'word', w: 'sûr', r: true, v: ['y'], en: 'sure' },
        { kind: 'word', w: 'sourire', syl: ['sou', 'rire'], r: true, v: ['u', 'i'], en: 'smile' },
        { kind: 'word', w: 'Russie', syl: ['Ru', 'ssie'], r: true, v: ['y', 'i'], en: 'Russia' },
        { kind: 'word', w: 'tortue', syl: ['tor', 'tue'], r: true, v: ['*', 'y'], en: 'turtle' },
      ] },
      { title: 'Little sentences', items: [
        { kind: 'sentence', s: 'Tu as vu la rue ?', focus: ['tu', 'vu', 'rue'], en: 'Did you see the street?' },
        { kind: 'sentence', s: 'Il a lu sur le lit.', focus: ['il', 'lu', 'sur', 'lit'], en: 'He read on the bed.' },
        { kind: 'sentence', s: 'Bonjour, tu souris !', focus: ['bonjour', 'tu', 'souris'], en: 'Hello, you’re smiling!' },
      ] },
    ],
  },
];
