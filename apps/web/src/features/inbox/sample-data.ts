/** Preview fixtures (ADR-0002). Invented people; only `sample-source.ts` imports this file. */
export type SampleMessage = { sender: 'customer' | 'operator'; text: string; at: string };

export type SampleThread = {
  id: string;
  name: string;
  username: string;
  unread: number;
  /** Relative time of the last message, as the list shows it. */
  at: string;
  messages: SampleMessage[];
};

const c = (text: string, at: string): SampleMessage => ({ sender: 'customer', text, at });
const o = (text: string, at: string): SampleMessage => ({ sender: 'operator', text, at });

export const SAMPLE_THREADS: SampleThread[] = [
  {
    id: 'cv-01',
    name: 'Mira Voloshyna',
    username: '@mira_v',
    unread: 2,
    at: 'now',
    messages: [
      c('Hi! Do you have peonies this week?', '10:02'),
      o('Hello Mira! Yes, a fresh delivery arrived this morning.', '10:04'),
      c('Lovely. Can I get 15 stems for tomorrow at noon?', '10:06'),
      c('Pink ones, if possible', '10:06'),
    ],
  },
  {
    id: 'cv-02',
    name: 'Tomas Berg',
    username: '@tberg',
    unread: 1,
    at: '4 min',
    messages: [
      c('Is the order for Saturday confirmed?', '09:40'),
      o('Let me check. One moment please.', '09:42'),
      o('Confirmed: delivery between 14:00 and 16:00.', '09:44'),
      c('Perfect, thank you!', '09:50'),
    ],
  },
  {
    id: 'cv-03',
    name: 'Ola Kravets',
    username: '@olakr',
    unread: 3,
    at: '27 min',
    messages: [
      c('Good morning! I need a bouquet for a birthday.', '08:55'),
      o('Happy to help. What is your budget?', '08:58'),
      c('Around 60 euros, nothing too big.', '09:01'),
      c('Maybe tulips?', '09:01'),
      c('And can you add a card with a short message?', '09:03'),
    ],
  },
  {
    id: 'cv-04',
    name: 'Henrik Salo',
    username: '@hsalo',
    unread: 0,
    at: '2 h',
    messages: [
      c('Do you deliver to the north district?', '07:30'),
      o('We do, the fee is 5 euros there.', '07:41'),
      c('Fine. Please send the roses to Pine Street 12.', '07:45'),
      o('Done, you will get a confirmation shortly.', '07:50'),
    ],
  },
  {
    id: 'cv-05',
    name: 'Daria Lysenko',
    username: '@daria_l',
    unread: 0,
    at: '5 h',
    messages: [
      c('The flowers arrived yesterday and they are gorgeous.', '18:20'),
      o('So glad to hear that, thank you for telling us!', '18:32'),
      c('I will order again for my mother next month.', '18:35'),
    ],
  },
  {
    id: 'cv-06',
    name: 'Jonas Albrecht',
    username: '@jonasa',
    unread: 1,
    at: '1 day',
    messages: [
      c('Can I change the delivery address of order 4417?', '15:10'),
      o('Sure, what is the new address?', '15:12'),
      c('Oak Avenue 8, apartment 3.', '15:14'),
      o('Updated. Anything else?', '15:15'),
      c('Could the courier call before arriving?', '15:20'),
    ],
  },
  {
    id: 'cv-07',
    name: 'Sofiia Rudenko',
    username: '@sofiia_r',
    unread: 0,
    at: '2 days',
    messages: [
      c('Do you make wedding arrangements?', '12:00'),
      o('Yes! We can book a consultation this week.', '12:20'),
      c('Thursday afternoon works for me.', '12:25'),
      o('Thursday at 15:00 is booked for you.', '12:30'),
      c('See you then!', '12:31'),
    ],
  },
  {
    id: 'cv-08',
    name: 'Lukas Meyer',
    username: '@lukasm',
    unread: 0,
    at: '3 days',
    messages: [
      c('How long will a bouquet of lilies stay fresh?', '11:05'),
      o('About a week if you trim the stems and change the water.', '11:15'),
      c('Thanks for the tip.', '11:16'),
    ],
  },
  {
    id: 'cv-09',
    name: 'Iryna Panchenko',
    username: '@iryna_p',
    unread: 0,
    at: '6 days',
    messages: [
      c('I would like a monthly flower subscription.', '16:00'),
      o('We offer weekly and monthly plans. Which one suits you?', '16:10'),
      c('Monthly, with seasonal flowers.', '16:12'),
      o('Great, I will send you the details.', '16:20'),
    ],
  },
  {
    id: 'cv-10',
    name: 'Viktor Nilsson',
    username: '@vnilsson',
    unread: 0,
    at: '9 days',
    messages: [
      c('Do you sell potted orchids?', '13:00'),
      o('We do, in white and purple.', '13:05'),
      c('I will pick up a white one on Friday.', '13:09'),
    ],
  },
  {
    id: 'cv-11',
    name: 'Zoya Marchenko',
    username: '@zoya_m',
    unread: 0,
    at: '11 days',
    messages: [
      c('My bouquet has a few wilted stems.', '17:40'),
      o('I am sorry about that. Could you send a photo?', '17:50'),
      c('Sent it by email.', '17:58'),
      o('Received. We will deliver a replacement tomorrow.', '18:10'),
    ],
  },
  {
    id: 'cv-12',
    name: 'Emil Hartmann',
    username: '@emilh',
    unread: 0,
    at: '13 days',
    messages: [
      c('Are you open on Sundays?', '09:00'),
      o('Yes, from 10:00 to 16:00.', '09:05'),
      c('Great, thanks.', '09:06'),
    ],
  },
];
