/**
 * Field taxonomy: the semantic knowledge base that powers field recognition.
 *
 * Each canonical FieldKind gets:
 *  - keywords:   token fragments matched against normalized signals
 *  - phrases:    multi-word phrases matched against label-ish text
 *  - autocomplete: HTML autocomplete attribute values (highest confidence)
 *  - inputTypes: HTML input types that hint the kind
 *  - negative:   tokens that veto a match (e.g. "last" vetoes firstName)
 *
 * This is deliberately data-driven so an LLM-based mapper can be swapped in
 * later (see services/mapping/): the taxonomy is just the offline default.
 */
export interface KindSpec {
  readonly kind: string;
  readonly keywords: readonly string[];
  readonly phrases: readonly string[];
  readonly autocomplete: readonly string[];
  readonly inputTypes?: readonly string[];
  readonly negative?: readonly string[];
}

export const TAXONOMY = [
  {
    kind: 'email',
    keywords: ['email', 'e-mail', 'mail', 'mailid', 'emailaddress', 'courriel', 'correo'],
    phrases: ['email address', 'e mail', 'work email', 'personal email', 'contact email', 'your email', 'candidate mail', 'user email'],
    autocomplete: ['email'],
    inputTypes: ['email'],
    negative: ['confirm', 'verify', 'mailing address', 'mail address line'],
  },
  {
    kind: 'firstName',
    keywords: ['firstname', 'fname', 'first', 'given', 'givenname', 'forename', 'prenom'],
    phrases: ['first name', 'given name', 'fore name'],
    autocomplete: ['given-name'],
    negative: ['last', 'family', 'sur', 'middle', 'full'],
  },
  {
    kind: 'lastName',
    keywords: ['lastname', 'lname', 'last', 'surname', 'familyname', 'family', 'apellido', 'nom'],
    phrases: ['last name', 'family name', 'sur name'],
    autocomplete: ['family-name'],
    negative: ['first', 'given', 'middle', 'full'],
  },
  {
    kind: 'middleName',
    keywords: ['middlename', 'middle', 'mname', 'middleinitial'],
    phrases: ['middle name', 'middle initial'],
    autocomplete: ['additional-name'],
    negative: ['first', 'last'],
  },
  {
    kind: 'fullName',
    keywords: ['fullname', 'name', 'yourname', 'applicantname', 'candidatename', 'contactname', 'displayname', 'realname'],
    phrases: ['full name', 'your name', 'applicant name', 'candidate name', 'complete name', 'legal name', 'name as per'],
    autocomplete: ['name'],
    negative: [
      'first', 'last', 'middle', 'user', 'company', 'business', 'school', 'college',
      'university', 'father', 'mother', 'file', 'project', 'card', 'bank', 'account', 'pet',
    ],
  },
  {
    kind: 'phone',
    keywords: ['phone', 'mobile', 'tel', 'telephone', 'cell', 'phonenumber', 'mobileno', 'contactno', 'whatsapp', 'telefono'],
    phrases: ['phone number', 'mobile number', 'contact number', 'cell phone', 'daytime phone', 'telephone number'],
    autocomplete: ['tel', 'tel-national', 'tel-local'],
    inputTypes: ['tel'],
    negative: ['extension', 'country code'],
  },
  {
    kind: 'addressLine1',
    keywords: ['address', 'address1', 'addressline1', 'street', 'streetaddress', 'addr1', 'line1'],
    phrases: ['address line 1', 'street address', 'address 1', 'mailing address', 'home address', 'current address', 'permanent address'],
    autocomplete: ['address-line1', 'street-address'],
    negative: ['2', 'line 2', 'email', 'ip', 'web', 'city', 'state', 'zip', 'country'],
  },
  {
    kind: 'addressLine2',
    keywords: ['address2', 'addressline2', 'addr2', 'line2', 'apartment', 'suite', 'unit', 'apt', 'flat'],
    phrases: ['address line 2', 'address 2', 'apt suite', 'apartment suite', 'suite unit'],
    autocomplete: ['address-line2'],
  },
  {
    kind: 'city',
    keywords: ['city', 'town', 'locality', 'ciudad', 'ville', 'district'],
    phrases: ['city town', 'your city'],
    autocomplete: ['address-level2'],
  },
  {
    kind: 'state',
    keywords: ['state', 'province', 'region', 'county', 'territory'],
    phrases: ['state province', 'state region'],
    autocomplete: ['address-level1'],
    negative: ['united states', 'statement'],
  },
  {
    kind: 'country',
    keywords: ['country', 'nation', 'pais'],
    phrases: ['country region'],
    autocomplete: ['country', 'country-name'],
    negative: ['county', 'code'],
  },
  {
    kind: 'zip',
    keywords: ['zip', 'zipcode', 'postal', 'postcode', 'postalcode', 'pincode', 'pin'],
    phrases: ['zip code', 'postal code', 'post code', 'pin code'],
    autocomplete: ['postal-code'],
  },
  {
    kind: 'linkedin',
    keywords: ['linkedin', 'linkedinurl', 'linkedinprofile'],
    phrases: ['linked in', 'linkedin profile', 'linkedin url'],
    autocomplete: [],
  },
  {
    kind: 'github',
    keywords: ['github', 'githuburl', 'gitlab', 'bitbucket'],
    phrases: ['github profile', 'github url', 'git hub'],
    autocomplete: [],
  },
  {
    kind: 'portfolio',
    keywords: ['portfolio', 'portfoliourl', 'worksamples'],
    phrases: ['portfolio url', 'portfolio link', 'work samples', 'personal portfolio'],
    autocomplete: [],
  },
  {
    kind: 'website',
    keywords: ['website', 'site', 'homepage', 'url', 'weburl', 'blog', 'personalsite'],
    phrases: ['personal website', 'web site', 'your website', 'home page'],
    autocomplete: ['url'],
    inputTypes: ['url'],
    negative: ['linkedin', 'github', 'portfolio', 'company'],
  },
  {
    kind: 'company',
    keywords: ['company', 'employer', 'organization', 'organisation', 'org', 'companyname', 'business', 'firm', 'workplace'],
    phrases: ['company name', 'current employer', 'organization name', 'current company', 'business name'],
    autocomplete: ['organization'],
  },
  {
    kind: 'jobTitle',
    keywords: ['jobtitle', 'title', 'designation', 'role', 'position', 'occupation', 'profession', 'currentrole'],
    phrases: ['job title', 'current title', 'current position', 'your role', 'current role', 'job role'],
    autocomplete: ['organization-title'],
    negative: ['mr', 'mrs', 'salutation', 'book', 'page'],
  },
  {
    kind: 'college',
    keywords: ['college', 'university', 'school', 'institution', 'institute', 'almamater', 'campus'],
    phrases: ['college name', 'university name', 'school name', 'educational institution', 'alma mater'],
    autocomplete: [],
    negative: ['high school year', 'schooling'],
  },
  {
    kind: 'degree',
    keywords: ['degree', 'qualification', 'education', 'major', 'course', 'branch', 'specialization', 'fieldofstudy'],
    phrases: ['degree name', 'highest qualification', 'field of study', 'highest degree', 'education level'],
    autocomplete: [],
  },
  {
    kind: 'graduationYear',
    keywords: ['graduationyear', 'gradyear', 'passingyear', 'yearofpassing', 'batch', 'classof'],
    phrases: ['graduation year', 'year of graduation', 'passing year', 'year of passing', 'class of', 'expected graduation'],
    autocomplete: [],
  },
  {
    kind: 'dateOfBirth',
    keywords: ['dob', 'dateofbirth', 'birthdate', 'birthday', 'born'],
    phrases: ['date of birth', 'birth date', 'your birthday'],
    autocomplete: ['bday'],
    inputTypes: ['date'],
  },
  {
    kind: 'nationality',
    keywords: ['nationality', 'citizenship', 'citizen'],
    phrases: ['your nationality', 'country of citizenship'],
    autocomplete: [],
  },
  {
    kind: 'gender',
    keywords: ['gender', 'sex'],
    phrases: ['your gender', 'gender identity'],
    autocomplete: ['sex'],
  },
  {
    kind: 'username',
    keywords: ['username', 'userid', 'login', 'loginid', 'handle', 'screenname'],
    phrases: ['user name', 'user id', 'login id'],
    autocomplete: ['username'],
    negative: ['email'],
  },
  {
    kind: 'password',
    keywords: ['password', 'passwd', 'pwd', 'passcode'],
    phrases: ['your password', 'create password'],
    autocomplete: ['current-password', 'new-password'],
    inputTypes: ['password'],
    negative: ['confirm', 'retype', 'reenter'],
  },
  {
    kind: 'salary',
    keywords: ['salary', 'ctc', 'compensation', 'expectedsalary', 'currentsalary', 'pay', 'remuneration'],
    phrases: ['expected salary', 'current salary', 'salary expectation', 'expected ctc', 'desired salary', 'expected compensation'],
    autocomplete: [],
  },
  {
    kind: 'yearsExperience',
    keywords: ['experience', 'yearsofexperience', 'yoe', 'totalexperience', 'workexperience'],
    phrases: ['years of experience', 'total experience', 'work experience', 'relevant experience'],
    autocomplete: [],
  },
  {
    kind: 'coverLetter',
    keywords: ['coverletter', 'about', 'aboutme', 'summary', 'bio', 'introduction', 'message', 'comments', 'additionalinfo'],
    phrases: ['cover letter', 'about yourself', 'tell us about', 'why do you want', 'additional information', 'personal statement', 'about me'],
    autocomplete: [],
  },
  {
    kind: 'pronouns',
    keywords: ['pronoun', 'pronouns'],
    phrases: ['preferred pronouns', 'your pronouns'],
    autocomplete: [],
  },
  {
    kind: 'location',
    keywords: ['location', 'currentlocation', 'basedin', 'residence'],
    phrases: ['current location', 'your location', 'where are you based', 'city and state', 'current city'],
    autocomplete: [],
    negative: ['ip', 'timezone', 'zone', 'geolocation'],
  },
  {
    kind: 'workAuthorization',
    keywords: ['workauthorization', 'workauthorized', 'workpermit', 'righttowork', 'workeligibility', 'employmenteligibility'],
    phrases: ['work authorization', 'authorized to work', 'legally authorized', 'right to work', 'work eligibility', 'eligible to work', 'visa status', 'work status'],
    autocomplete: [],
    negative: ['sponsor', 'sponsorship'],
  },
  {
    kind: 'sponsorship',
    keywords: ['sponsorship', 'sponsor', 'visasponsorship'],
    phrases: ['require sponsorship', 'need sponsorship', 'visa sponsorship', 'require visa sponsorship', 'sponsorship required', 'require immigration'],
    autocomplete: [],
  },
  {
    kind: 'noticePeriod',
    keywords: ['noticeperiod', 'notice'],
    phrases: ['notice period', 'notice days', 'how much notice'],
    autocomplete: [],
  },
  {
    kind: 'startDate',
    keywords: ['startdate', 'availability', 'availablefrom', 'joiningdate', 'earlieststart'],
    phrases: ['start date', 'available start date', 'availability date', 'earliest start', 'joining date', 'when can you start', 'available from', 'date available'],
    autocomplete: [],
    negative: ['end date', 'birth'],
  },
  {
    kind: 'relocate',
    keywords: ['relocate', 'relocation', 'willingtorelocate'],
    phrases: ['willing to relocate', 'open to relocation', 'able to relocate'],
    autocomplete: [],
  },
  {
    kind: 'references',
    keywords: ['references', 'referee', 'referees', 'reference'],
    phrases: ['professional references', 'reference contact'],
    autocomplete: [],
    negative: ['number', 'code', 'id', 'requisition', 'job', 'order', 'self'],
  },
  {
    kind: 'veteranStatus',
    keywords: ['veteran', 'veteranstatus', 'military'],
    phrases: ['veteran status', 'protected veteran', 'military service'],
    autocomplete: [],
  },
  {
    kind: 'disabilityStatus',
    keywords: ['disability', 'disabled', 'disabilitystatus'],
    phrases: ['disability status', 'do you have a disability'],
    autocomplete: [],
  },
  {
    kind: 'ethnicity',
    keywords: ['ethnicity', 'race', 'ethnic', 'hispanic', 'latino'],
    phrases: ['race ethnicity', 'ethnic background', 'racial background'],
    autocomplete: [],
    negative: ['racing', 'trace'],
  },
] as const satisfies readonly KindSpec[];

export type FieldKind = (typeof TAXONOMY)[number]['kind'] | 'unknown';
