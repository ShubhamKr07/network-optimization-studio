export interface LegalSection {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface LegalDoc {
  slug: "terms" | "privacy";
  title: string;
  intro: string;
  sections: LegalSection[];
}

export const TERMS_OF_SERVICE: LegalDoc = {
  slug: "terms",
  title: "Terms of Service",
  intro:
    "These terms cover your use of Optimization Studio (\"the app\"), a teaching tool built around the textbook Supply Chain Network Design. You are using it because your instructor or institution chose it for your course. By ticking the box when you register or log in, you agree to these terms and to the Privacy Notice.",
  sections: [
    {
      heading: "Your account",
      paragraphs: [
        "Use your own email address and keep your password to yourself. One account is for one person.",
        "You are responsible for what happens under your account. If you think someone else has used it, reset your password from the log-in page.",
      ],
    },
    {
      heading: "Using the app",
      paragraphs: ["Use the app for learning: building scenarios, solving them and comparing the results for your course."],
      bullets: [
        "Do not try to reach another person's account or data.",
        "Do not overload, probe or attack the app, or run automated scripts against it.",
        "Do not upload anything unlawful, or anything you do not have the right to share.",
        "Follow your instructor's rules on how the app and WatBot may be used in graded work.",
      ],
    },
    {
      heading: "WatBot",
      paragraphs: [
        "WatBot is an AI tutor. It answers from the course's sources, but its answers can still be wrong or incomplete. Check important points against the textbook and with your instructor.",
        "Your questions, the context sent with them and WatBot's answers are processed by Anthropic to produce the answers, and are stored with your account. The Privacy Notice explains this.",
      ],
    },
    {
      heading: "Your work",
      paragraphs: [
        "Scenarios you create stay yours. You allow us to store and process them only to run the app for you.",
        "Results come from a real optimization solver run on teaching data. They are for learning, and they are not advice for real business decisions.",
      ],
    },
    {
      heading: "Availability and changes",
      paragraphs: [
        "The app is provided as it is, for teaching. It may change, be unavailable at times, or be withdrawn. We may suspend an account that breaks these terms.",
      ],
    },
    {
      heading: "Limits on our responsibility",
      paragraphs: [
        "To the extent the law allows, we are not responsible for indirect losses, or for decisions made using the app's results. Nothing in these terms limits rights you have under the law that cannot be limited.",
      ],
    },
    {
      heading: "Ending your use",
      paragraphs: [
        "You can stop at any time. You can delete your account yourself from the home page with \"Delete my account\". The Privacy Notice says what that removes.",
      ],
    },
    {
      heading: "Changes to these terms",
      paragraphs: [
        "If these terms change, the version date at the top changes and you will be asked to accept the new version the next time you log in.",
      ],
    },
  ],
};

export const PRIVACY_NOTICE: LegalDoc = {
  slug: "privacy",
  title: "Privacy Notice",
  intro:
    "This notice explains what Optimization Studio (\"the app\") stores about you, which outside services receive it, and how to use your rights. The app is used on behalf of your instructor or institution as part of your course.",
  sections: [
    {
      heading: "What the app stores",
      paragraphs: [
        "Site feedback you send with the feedback button is stored without your account, your session or your IP address. It is anonymous: it cannot be traced back to you, so it cannot be found or removed per account.",
        "Your IP address is used briefly, in memory, to limit repeated log-in and reset attempts. It is not stored in the app's database, but our hosting provider's request logs may record it.",
      ],
      bullets: [
        "Your account: your email address, your password stored only as a one-way hash (we cannot read it), your role, and when the account was created and last changed.",
        "Your acceptance of these terms: which version you accepted and when.",
        "Your work: the scenarios you create, their inputs and results, and the history of your solves.",
        "WatBot: your questions, the context sent with them (such as the open tab and a summary of the selected scenario), WatBot's answers, and any rating or report you give an answer.",
        "Password reset: a hashed one-time reset code and its expiry time, kept for at most one hour.",
      ],
    },
    {
      heading: "Why we use it",
      paragraphs: ["We do not sell your information or use it for advertising."],
      bullets: [
        "To run the app: sign you in, save your work, solve your scenarios and answer your WatBot questions.",
        "To keep the app secure and to find and fix errors.",
        "To understand, in aggregate, how features are used, so the course and the app can be improved.",
      ],
    },
    {
      heading: "Outside services that receive your data",
      paragraphs: [
        "Each of these services processes data for us, under its own terms, to provide the part of the app listed. Most are based in the United States, so your data may be processed there.",
      ],
      bullets: [
        "Anthropic (WatBot): your WatBot questions, the context sent with them, and the answers.",
        "PostHog (usage analytics): pages you view and controls you use (on-screen text is masked), your account id, and your email address.",
        "Sentry (error reports): technical details of errors, the page address (without query strings), your browser type, and your account id. Request bodies and cookies are removed before sending.",
        "Resend (email): your email address and the reset link, when you ask for a password reset.",
        "OpenRouteService (road distances): the map coordinates of the sites in a network, when you ask for road distances. No account details are sent.",
        "Render (hosting): runs the app and its database, so it holds everything the app stores, including backups.",
      ],
    },
    {
      heading: "Cookies and browser storage",
      paragraphs: [],
      bullets: [
        "One sign-in cookie, which keeps you logged in for up to 7 days.",
        "PostHog stores an analytics identifier in your browser.",
        "The app remembers display settings, such as the theme, in your browser's storage.",
      ],
    },
    {
      heading: "How long we keep it",
      paragraphs: [
        "We keep your data until you delete your account. Password-reset codes expire after one hour. Our hosting provider keeps database backups for a limited period, so deleted data can remain in a backup until that backup expires.",
      ],
    },
    {
      heading: "Your rights and how to use them",
      paragraphs: [
        "Delete your account yourself: on the home page, choose \"Delete my account\" and confirm with your password. This permanently deletes your account, your scenarios and solves, your WatBot conversations, ratings and reports, and your record of which version you accepted.",
        "In-app deletion does not reach copies held by PostHog, Sentry or Anthropic, or database backups. To ask for those to be deleted, or to ask for a copy of your data or a correction, write to the contact address below.",
        "Depending on where you live, laws such as the GDPR may give you further rights, including to object to or restrict processing, and to complain to your data protection authority.",
      ],
    },
    {
      heading: "Education records (FERPA)",
      paragraphs: [
        "The app is used on behalf of your instructor or institution, and records of your coursework in it may be education records under FERPA. Your institution governs consent for and access to those records; you may also direct requests to your institution.",
      ],
    },
    {
      heading: "Children",
      paragraphs: ["The app is meant for university and college courses and is not directed at children under 13."],
    },
    {
      heading: "Changes to this notice",
      paragraphs: [
        "If this notice changes, the version date at the top changes and you will be asked to accept the new version the next time you log in.",
      ],
    },
  ],
};
