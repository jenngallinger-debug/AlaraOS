/**
 * Alara OS — Education Content
 *
 * Program knowledge organized for layered depth.
 * Source: legacy content adapted, not copied structurally.
 */

export interface EducationCard {
  id: string;
  title: string;
  tagline: string;
  /** Who this is most relevant to */
  audience: string[];
  summary: string;
  detail: string;
  examples: string[];
  expertNote: string;
  resources: { label: string; url?: string }[];
  relatedIds: string[];
}

export const EDUCATION_CARDS: EducationCard[] = [
  {
    id: 'eeoicpa',
    title: 'EEOICPA / White Card',
    tagline: 'Federal workers and their families may be entitled to fully covered home health care.',
    audience: ['patient', 'family', 'attorney', 'unsure'],
    summary:
      'If you or a family member worked at a Department of Energy facility or with nuclear materials, you may qualify for free home health care through the Energy Employees Occupational Illness Compensation Program Act (EEOICPA). There are no copays, no deductibles, and no income requirements.',
    detail:
      'EEOICPA covers former DOE contract workers, uranium miners, millers, and ore transporters who developed certain illnesses as a result of their work. Covered conditions include specific cancers, beryllium disease, silicosis, and others. The White Card — formally the OWCP Medical Authorization Card — authorizes care directly, so providers bill the government, not the patient.',
    examples: [
      'A retired Hanford site worker who developed lung cancer and needs skilled nursing at home.',
      'A widow of a DOE contractor seeking home health support as an eligible surviving family member.',
      'A uranium miner diagnosed with silicosis who was unaware their care could be fully covered.',
    ],
    expertNote:
      'EEOICPA has two parts: Part B for DOE workers and designated facilities, and Part E for DOE contractor employees. Eligibility, covered conditions, and compensation structures differ. An Alara Care Guide can review your specific situation and help you understand which part applies.',
    resources: [
      { label: 'DOL EEOICPA Overview', url: 'https://www.dol.gov/agencies/owcp/energy' },
      { label: 'Call Alara to verify eligibility' },
    ],
    relatedIds: ['owcp', 'home-health'],
  },
  {
    id: 'va',
    title: 'Veterans & VA Benefits',
    tagline: 'Veterans who served may qualify for home health care as part of their earned benefits.',
    audience: ['patient', 'family', 'unsure'],
    summary:
      'The Department of Veterans Affairs offers home health benefits for eligible veterans, including skilled nursing, home health aide services, and in some cases, Community Care options through non-VA providers like Alara. Benefits depend on your service history, disability rating, and clinical need.',
    detail:
      'Veterans enrolled in VA healthcare may access home-based primary care, skilled home health, or community care programs depending on their situation. VA Community Care allows veterans to receive care from approved providers in their community when VA facilities are not accessible or a specific service isn\'t available through the VA. Alara works with veterans and their families to navigate these options.',
    examples: [
      'A Vietnam veteran with a service-connected condition who needs wound care at home.',
      'A family caregiver supporting a veteran who is unsure which VA program applies.',
      'A veteran recently discharged who needs skilled nursing during recovery.',
    ],
    expertNote:
      'Navigating VA benefits for home health can be complex — eligibility, priority groups, and community care authorization each have their own requirements. Alara Care Guides have direct experience helping veterans and families understand what they\'ve earned.',
    resources: [
      { label: 'VA Home Health Care Overview', url: 'https://www.va.gov/health-care/about-va-health-benefits/home-health-care/' },
      { label: 'Call Alara to discuss VA options' },
    ],
    relatedIds: ['home-health', 'family-caregiver'],
  },
  {
    id: 'owcp',
    title: 'OWCP / Federal Workers',
    tagline: 'Federal employees injured on the job have dedicated coverage for home health care.',
    audience: ['patient', 'family', 'unsure'],
    summary:
      'The Office of Workers\' Compensation Programs (OWCP) covers federal employees injured in the course of their work. If you or a family member was a federal employee and sustained an injury or illness related to work, OWCP may cover home health care at no cost to you.',
    detail:
      'OWCP administers several programs: the Federal Employees\' Compensation Act (FECA) for most federal workers, EEOICPA for energy workers, and the Longshore and Harbor Workers\' Compensation Act (LHWCA). FECA covers medical treatment, lost wages, and vocational rehabilitation for federal employees injured on the job, including skilled nursing and home health when medically necessary.',
    examples: [
      'A postal worker who suffered a back injury and needs physical therapy and home nursing.',
      'A federal law enforcement officer with a duty-related illness that requires ongoing home care.',
    ],
    expertNote:
      'OWCP claims can take time to process, and care authorization varies by claim status. Alara can help you understand your current authorization, what\'s covered, and how to communicate with OWCP on your behalf.',
    resources: [
      { label: 'OWCP FECA Program', url: 'https://www.dol.gov/agencies/owcp/dfec' },
      { label: 'Call Alara to discuss your claim' },
    ],
    relatedIds: ['eeoicpa', 'home-health'],
  },
  {
    id: 'family-caregiver',
    title: 'Family Caregivers',
    tagline: 'Caring for someone you love is one of the hardest things there is. Alara is here to help carry it.',
    audience: ['family', 'unsure'],
    summary:
      'Family caregivers are often managing more than anyone realizes — medical appointments, medications, safety concerns, emotional weight, and their own lives. Alara\'s role is to reduce that load by coordinating professional care at home, explaining options, and making sure nothing falls through the cracks.',
    detail:
      'When a professional home health team supports your family member, you don\'t have to manage clinical decisions alone. Alara coordinates skilled nursing, therapy, and aide services, communicates with physicians, and keeps you informed at every step. We work with Medicare, Medicaid, VA, EEOICPA, OWCP, and private insurance.',
    examples: [
      'An adult child managing care for a parent after a hospital discharge who isn\'t sure what help is available.',
      'A spouse caring for a partner with a chronic condition who needs respite and professional nursing support.',
      'A family navigating care for a veteran who doesn\'t know what VA benefits include at home.',
    ],
    expertNote:
      'Caregiver burnout is real and serious. Part of Alara\'s job is making sure caregivers don\'t carry more than they should. Our Care Guides work with families as partners, not just as service coordinators.',
    resources: [
      { label: 'Talk to an Alara Care Guide' },
    ],
    relatedIds: ['home-health', 'va', 'eeoicpa'],
  },
  {
    id: 'home-health',
    title: 'Home Health Care',
    tagline: 'Skilled care delivered at home — the medical team comes to you.',
    audience: ['patient', 'family', 'physician', 'referral_source', 'unsure'],
    summary:
      'Home health care brings skilled nursing, physical therapy, occupational therapy, speech therapy, and home health aide services directly to a patient\'s home. It\'s appropriate after hospitalizations, for chronic conditions, and for patients who need clinical care but prefer or require staying at home.',
    detail:
      'Medicare-covered home health requires physician orders and a homebound status determination. Private insurance, VA, EEOICPA, OWCP, and Medicaid each have their own requirements. Alara\'s clinical team works with the patient\'s physician to ensure appropriate orders, manages the clinical care plan, and keeps the care team and family informed.',
    examples: [
      'A patient discharged after hip replacement surgery who needs physical therapy at home.',
      'A patient with diabetes and a non-healing wound who needs wound care nursing visits.',
      'An elderly patient who is homebound and needs regular skilled nursing assessments.',
    ],
    expertNote:
      'Homebound status is often misunderstood — it doesn\'t mean the patient can never leave home, but that leaving requires considerable effort. Many patients who think they don\'t qualify actually do. Alara can help clarify this with the patient\'s physician.',
    resources: [
      { label: 'Medicare Home Health Coverage', url: 'https://www.medicare.gov/coverage/home-health-services' },
      { label: 'Request a clinical evaluation from Alara' },
    ],
    relatedIds: ['family-caregiver', 'va', 'eeoicpa'],
  },
  {
    id: 'physicians',
    title: 'Physicians & Referral Sources',
    tagline: 'Referring to Alara takes one call. We handle everything from there.',
    audience: ['physician', 'referral_source', 'case_manager'],
    summary:
      'Alara accepts physician referrals for home health services across Medicare, private insurance, VA, EEOICPA, OWCP, and Medicaid. Our clinical team contacts the patient within 4 hours of receiving a referral, completes the intake, obtains necessary authorizations, and keeps the referring physician informed.',
    detail:
      'We make it easy to refer: phone, fax, or online. Alara handles insurance verification, authorization, patient contact, and scheduling. You receive updates on patient progress and are notified of any clinical concerns that may require your attention. Our team works collaboratively with the referring provider to ensure care plan alignment.',
    examples: [
      'A hospitalist discharging a patient who needs wound care and physical therapy at home.',
      'A primary care physician whose patient needs ongoing nursing for a chronic condition.',
      'A social worker coordinating a complex discharge who needs a reliable home health partner.',
    ],
    expertNote:
      'Alara specializes in complex cases — EEOICPA, VA Community Care, and patients with multiple coverage sources. If you\'re unsure whether a patient qualifies or which program applies, call us. We\'ll figure it out together.',
    resources: [
      { label: 'Make a referral — call or use the form above' },
    ],
    relatedIds: ['home-health', 'eeoicpa', 'va'],
  },
];

export function getCardById(id: string): EducationCard | undefined {
  return EDUCATION_CARDS.find(c => c.id === id);
}

export function getCardsForAudience(audience: string): EducationCard[] {
  return EDUCATION_CARDS.filter(c => c.audience.includes(audience));
}
