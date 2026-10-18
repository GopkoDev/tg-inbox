/** Preview fixtures (ADR-0002). Invented people; only `sample-source.ts` imports this file. */
export type SampleHistoryEntry = { at: string; direction: 'in' | 'out'; text: string };

export type SampleContactRecord = {
  id: string;
  name: string;
  username: string;
  tags: string[];
  language: string;
  firstMessageAt: string;
  lastMessageAt: string;
  history: SampleHistoryEntry[];
};

export const SAMPLE_CONTACTS: SampleContactRecord[] = [
  {
    id: 'ct-01',
    name: 'Mira Voloshyna',
    username: '@mira_v',
    tags: ['VIP', 'Florist'],
    language: 'Ukrainian',
    firstMessageAt: '2 Feb 2026',
    lastMessageAt: '7 min ago',
    history: [
      {
        at: '2 Feb 2026, 10:01',
        direction: 'in',
        text: 'Hi, Mira here: is order #101 ready for pickup?',
      },
      {
        at: '2 Feb 2026, 10:11',
        direction: 'out',
        text: 'Hello Mira! Order #101 is ready until 19:00.',
      },
      {
        at: '2 Feb 2026, 10:21',
        direction: 'in',
        text: 'Great, I will come by after work (#101).',
      },
    ],
  },
  {
    id: 'ct-02',
    name: 'Tomas Berg',
    username: '@tberg',
    tags: ['Wholesale'],
    language: 'English',
    firstMessageAt: '3 Feb 2026',
    lastMessageAt: '14 min ago',
    history: [
      {
        at: '3 Feb 2026, 10:02',
        direction: 'in',
        text: 'Hi, Tomas here: is order #102 ready for pickup?',
      },
      {
        at: '3 Feb 2026, 10:12',
        direction: 'out',
        text: 'Hello Tomas! Order #102 is ready until 19:00.',
      },
      {
        at: '3 Feb 2026, 10:22',
        direction: 'in',
        text: 'Great, I will come by after work (#102).',
      },
    ],
  },
  {
    id: 'ct-03',
    name: 'Ola Kravets',
    username: '@olakr',
    tags: ['VIP'],
    language: 'Ukrainian',
    firstMessageAt: '4 Feb 2026',
    lastMessageAt: '21 min ago',
    history: [
      {
        at: '4 Feb 2026, 10:03',
        direction: 'in',
        text: 'Hi, Ola here: is order #103 ready for pickup?',
      },
      {
        at: '4 Feb 2026, 10:13',
        direction: 'out',
        text: 'Hello Ola! Order #103 is ready until 19:00.',
      },
      {
        at: '4 Feb 2026, 10:23',
        direction: 'in',
        text: 'Great, I will come by after work (#103).',
      },
    ],
  },
  {
    id: 'ct-04',
    name: 'Henrik Salo',
    username: '@hsalo',
    tags: ['Wholesale', 'Events'],
    language: 'Finnish',
    firstMessageAt: '5 Feb 2026',
    lastMessageAt: '28 min ago',
    history: [
      {
        at: '5 Feb 2026, 10:04',
        direction: 'in',
        text: 'Hi, Henrik here: is order #104 ready for pickup?',
      },
      {
        at: '5 Feb 2026, 10:14',
        direction: 'out',
        text: 'Hello Henrik! Order #104 is ready until 19:00.',
      },
      {
        at: '5 Feb 2026, 10:24',
        direction: 'in',
        text: 'Great, I will come by after work (#104).',
      },
    ],
  },
  {
    id: 'ct-05',
    name: 'Daria Lysenko',
    username: '@daria_l',
    tags: [],
    language: 'Ukrainian',
    firstMessageAt: '6 Feb 2026',
    lastMessageAt: '35 min ago',
    history: [
      {
        at: '6 Feb 2026, 10:05',
        direction: 'in',
        text: 'Hi, Daria here: is order #105 ready for pickup?',
      },
      {
        at: '6 Feb 2026, 10:15',
        direction: 'out',
        text: 'Hello Daria! Order #105 is ready until 19:00.',
      },
      {
        at: '6 Feb 2026, 10:25',
        direction: 'in',
        text: 'Great, I will come by after work (#105).',
      },
    ],
  },
  {
    id: 'ct-06',
    name: 'Jonas Albrecht',
    username: '@jonasa',
    tags: ['Events'],
    language: 'German',
    firstMessageAt: '7 Feb 2026',
    lastMessageAt: '42 min ago',
    history: [
      {
        at: '7 Feb 2026, 10:06',
        direction: 'in',
        text: 'Hi, Jonas here: is order #106 ready for pickup?',
      },
      {
        at: '7 Feb 2026, 10:16',
        direction: 'out',
        text: 'Hello Jonas! Order #106 is ready until 19:00.',
      },
      {
        at: '7 Feb 2026, 10:26',
        direction: 'in',
        text: 'Great, I will come by after work (#106).',
      },
    ],
  },
  {
    id: 'ct-07',
    name: 'Sofiia Rudenko',
    username: '@sofiia_r',
    tags: ['VIP', 'Events'],
    language: 'Ukrainian',
    firstMessageAt: '8 Feb 2026',
    lastMessageAt: '49 min ago',
    history: [
      {
        at: '8 Feb 2026, 10:07',
        direction: 'in',
        text: 'Hi, Sofiia here: is order #107 ready for pickup?',
      },
      {
        at: '8 Feb 2026, 10:17',
        direction: 'out',
        text: 'Hello Sofiia! Order #107 is ready until 19:00.',
      },
      {
        at: '8 Feb 2026, 10:27',
        direction: 'in',
        text: 'Great, I will come by after work (#107).',
      },
    ],
  },
  {
    id: 'ct-08',
    name: 'Lukas Meyer',
    username: '@lukasm',
    tags: ['Florist'],
    language: 'German',
    firstMessageAt: '9 Feb 2026',
    lastMessageAt: '56 min ago',
    history: [
      {
        at: '9 Feb 2026, 10:08',
        direction: 'in',
        text: 'Hi, Lukas here: is order #108 ready for pickup?',
      },
      {
        at: '9 Feb 2026, 10:18',
        direction: 'out',
        text: 'Hello Lukas! Order #108 is ready until 19:00.',
      },
      {
        at: '9 Feb 2026, 10:28',
        direction: 'in',
        text: 'Great, I will come by after work (#108).',
      },
    ],
  },
  {
    id: 'ct-09',
    name: 'Iryna Panchenko',
    username: '@iryna_p',
    tags: ['Wholesale'],
    language: 'Ukrainian',
    firstMessageAt: '10 Feb 2026',
    lastMessageAt: '63 min ago',
    history: [
      {
        at: '10 Feb 2026, 10:09',
        direction: 'in',
        text: 'Hi, Iryna here: is order #109 ready for pickup?',
      },
      {
        at: '10 Feb 2026, 10:19',
        direction: 'out',
        text: 'Hello Iryna! Order #109 is ready until 19:00.',
      },
      {
        at: '10 Feb 2026, 10:29',
        direction: 'in',
        text: 'Great, I will come by after work (#109).',
      },
    ],
  },
  {
    id: 'ct-10',
    name: 'Viktor Nilsson',
    username: '@vnilsson',
    tags: [],
    language: 'Swedish',
    firstMessageAt: '11 Feb 2026',
    lastMessageAt: '70 min ago',
    history: [
      {
        at: '11 Feb 2026, 10:00',
        direction: 'in',
        text: 'Hi, Viktor here: is order #110 ready for pickup?',
      },
      {
        at: '11 Feb 2026, 10:10',
        direction: 'out',
        text: 'Hello Viktor! Order #110 is ready until 19:00.',
      },
      {
        at: '11 Feb 2026, 10:20',
        direction: 'in',
        text: 'Great, I will come by after work (#110).',
      },
    ],
  },
  {
    id: 'ct-11',
    name: 'Zoya Marchenko',
    username: '@zoya_m',
    tags: ['VIP'],
    language: 'Ukrainian',
    firstMessageAt: '12 Feb 2026',
    lastMessageAt: '77 min ago',
    history: [
      {
        at: '12 Feb 2026, 10:01',
        direction: 'in',
        text: 'Hi, Zoya here: is order #111 ready for pickup?',
      },
      {
        at: '12 Feb 2026, 10:11',
        direction: 'out',
        text: 'Hello Zoya! Order #111 is ready until 19:00.',
      },
      {
        at: '12 Feb 2026, 10:21',
        direction: 'in',
        text: 'Great, I will come by after work (#111).',
      },
    ],
  },
  {
    id: 'ct-12',
    name: 'Emil Hartmann',
    username: '@emilh',
    tags: ['Florist', 'Events'],
    language: 'English',
    firstMessageAt: '13 Feb 2026',
    lastMessageAt: '84 min ago',
    history: [
      {
        at: '13 Feb 2026, 10:02',
        direction: 'in',
        text: 'Hi, Emil here: is order #112 ready for pickup?',
      },
      {
        at: '13 Feb 2026, 10:12',
        direction: 'out',
        text: 'Hello Emil! Order #112 is ready until 19:00.',
      },
      {
        at: '13 Feb 2026, 10:22',
        direction: 'in',
        text: 'Great, I will come by after work (#112).',
      },
    ],
  },
];
