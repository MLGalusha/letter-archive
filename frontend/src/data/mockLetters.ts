import type { Letter } from "../types/Letter";

// Mock letter data for development
// This can be easily swapped out for API calls later
export const mockLetters: Letter[] = [
  {
    id: "1",
    title: "Letter from Samuel to Anna",
    images: [
      {
        id: "img-1-1",
        type: "letter_page",
        pageNumber: 1,
        imageUrl: "/src/assets/mock/001-L-111888-1.JPG",
      },
      {
        id: "img-1-2",
        type: "letter_page",
        pageNumber: 2,
        imageUrl: "/src/assets/mock/001-L-111888-2.JPG",
      },
      {
        id: "img-1-3",
        type: "letter_page",
        pageNumber: 3,
        imageUrl: "/src/assets/mock/001-L-111888-3.JPG",
      },
      {
        id: "img-1-4",
        type: "letter_page",
        pageNumber: 4,
        imageUrl: "/src/assets/mock/001-L-111888-4.JPG",
      },
      {
        id: "img-1-5",
        type: "envelope_front",
        imageUrl: "/src/assets/mock/001-E-111888.JPG",
      },
    ],
    transcript: {
      pages: [
        {
          pageNumber: 1,
          text: "Dear Anna,\n\nI hope this letter finds you well. The spring planting has been delayed this year due to the late frost. The seed costs have risen considerably, and I fear it will be a difficult season for all of us farmers.\n\nI trust you and the children are in good health.\n\nYour loving brother,\nSamuel",
          confidence: 0.95,
        },
      ],
      fullText:
        "Dear Anna,\n\nI hope this letter finds you well. The spring planting has been delayed this year due to the late frost. The seed costs have risen considerably, and I fear it will be a difficult season for all of us farmers.\n\nI trust you and the children are in good health.\n\nYour loving brother,\nSamuel",
      verified: true,
    },
    metadata: {
      sender: "Samuel R. Fisher",
      recipient: "Anna Fisher",
      date: "March 12, 1891",
      location: "Lancaster, Pennsylvania",
      description:
        "Mentions delays in the spring planting and concerns about seed costs.",
      verified: true,
      verifiedBy: "Historical Society",
      verifiedAt: "2024-01-15T10:00:00Z",
    },
    status: "published",
    createdAt: "2024-01-10T08:00:00Z",
  },
  {
    id: "2",
    title: "Letter from Michael to Thomas",
    images: [
      {
        id: "img-2-1",
        type: "letter_page",
        pageNumber: 1,
        imageUrl: "/src/assets/mock/002-L-11131900-1.jpg",
      },
      {
        id: "img-2-2",
        type: "letter_page",
        pageNumber: 2,
        imageUrl: "/src/assets/mock/002-L-11131900-2.jpg",
      },
      {
        id: "img-2-3",
        type: "letter_page",
        pageNumber: 3,
        imageUrl: "/src/assets/mock/002-L-11131900-3.jpg",
      },
      {
        id: "img-2-4",
        type: "envelope_front",
        imageUrl: "/src/assets/mock/002-C-11131900.jpg",
      },
    ],
    transcript: {
      pages: [
        {
          pageNumber: 1,
          text: "Dear Thomas,\n\nThe mine has been brutal this week. Working sixteen-hour shifts with barely time to sleep. Young Jimmy had an accident on Tuesday - his hand got caught in the machinery. Doctor says he'll recover but won't be able to work for months.\n\nSend my love to Mother.\n\nMichael",
          confidence: 0.92,
        },
      ],
      fullText:
        "Dear Thomas,\n\nThe mine has been brutal this week. Working sixteen-hour shifts with barely time to sleep. Young Jimmy had an accident on Tuesday - his hand got caught in the machinery. Doctor says he'll recover but won't be able to work for months.\n\nSend my love to Mother.\n\nMichael",
      verified: true,
    },
    metadata: {
      sender: "Michael O'Hara",
      recipient: "Thomas O'Hara",
      date: "October 4, 1907",
      location: "Scranton, Pennsylvania",
      description:
        "Describes long hours at the mine and a recent workplace injury.",
      verified: true,
      verifiedBy: "Labor History Archive",
      verifiedAt: "2024-02-01T14:30:00Z",
    },
    status: "published",
    createdAt: "2024-01-12T09:00:00Z",
  },
  {
    id: "3",
    title: "Letter from Clara to Elsie",
    images: [
      {
        id: "img-3-1",
        type: "letter_page",
        pageNumber: 1,
        imageUrl: "/src/assets/mock/002-L-12141900-1.jpg",
      },
      {
        id: "img-3-2",
        type: "letter_page",
        pageNumber: 2,
        imageUrl: "/src/assets/mock/002-L-12141900-2.jpg",
      },
      {
        id: "img-3-3",
        type: "letter_page",
        pageNumber: 3,
        imageUrl: "/src/assets/mock/002-L-12141900-3.jpg",
      },
      {
        id: "img-3-4",
        type: "letter_page",
        pageNumber: 4,
        imageUrl: "/src/assets/mock/002-L-12141900-4.jpg",
      },
      {
        id: "img-3-5",
        type: "letter_page",
        pageNumber: 5,
        imageUrl: "/src/assets/mock/002-L-12141900-5.jpg",
      },
      {
        id: "img-3-6",
        type: "letter_page",
        pageNumber: 6,
        imageUrl: "/src/assets/mock/002-L-12141900-6.jpg",
      },
      {
        id: "img-3-7",
        type: "letter_page",
        pageNumber: 7,
        imageUrl: "/src/assets/mock/002-L-12141900-7.jpg",
      },
      {
        id: "img-3-8",
        type: "envelope_front",
        imageUrl: "/src/assets/mock/002-C-12141900.jpg",
      },
    ],
    transcript: {
      pages: [
        {
          pageNumber: 1,
          text: "Dearest Elsie,\n\nThe household expenses continue to rise. Flour has gone up another two cents this week. I don't know how we're expected to manage with these prices.",
          confidence: 0.88,
        },
        {
          pageNumber: 2,
          text: "Father is working extra hours at the factory, but it barely covers the rent. Please write when you can.\n\nWith love,\nClara",
          confidence: 0.90,
        },
      ],
      fullText:
        "Dearest Elsie,\n\nThe household expenses continue to rise. Flour has gone up another two cents this week. I don't know how we're expected to manage with these prices.\n\nFather is working extra hours at the factory, but it barely covers the rent. Please write when you can.\n\nWith love,\nClara",
      verified: true,
    },
    metadata: {
      sender: "Clara Whitmore",
      recipient: "Elsie Whitmore",
      date: "June 18, 1916",
      location: "Des Moines, Iowa",
      description: "Talks about household expenses and the rising cost of flour.",
      verified: true,
    },
    status: "published",
    createdAt: "2024-01-14T11:00:00Z",
  },
  {
    id: "4",
    title: "Letter from Henry to Joseph",
    images: [
      {
        id: "img-4-1",
        type: "letter_page",
        pageNumber: 1,
        imageUrl: "/src/assets/mock/001-L-111888-1.JPG",
      },
      {
        id: "img-4-2",
        type: "envelope_front",
        imageUrl: "/src/assets/mock/001-E-111888.JPG",
      },
    ],
    transcript: {
      pages: [
        {
          pageNumber: 1,
          text: "Joseph,\n\nThe seasonal work has dried up and I find myself without employment. Do you know of any positions available in your area? I am willing to travel and work any honest job.\n\nYour friend,\nHenry",
          confidence: 0.94,
        },
      ],
      fullText:
        "Joseph,\n\nThe seasonal work has dried up and I find myself without employment. Do you know of any positions available in your area? I am willing to travel and work any honest job.\n\nYour friend,\nHenry",
      verified: false,
    },
    metadata: {
      sender: "Henry Lawson",
      recipient: "Joseph Price",
      date: "February 2, 1923",
      location: "Mobile, Alabama",
      description: "Requests assistance finding work after seasonal layoffs.",
      verified: false,
    },
    status: "published",
    createdAt: "2024-01-16T13:00:00Z",
  },
  {
    id: "5",
    title: "Letter from Ruth to Miriam",
    images: [
      {
        id: "img-5-1",
        type: "letter_page",
        pageNumber: 1,
        imageUrl: "/src/assets/mock/002-L-11131900-1.jpg",
      },
      {
        id: "img-5-2",
        type: "envelope_front",
        imageUrl: "/src/assets/mock/002-C-11131900.jpg",
      },
    ],
    transcript: {
      pages: [
        {
          pageNumber: 1,
          text: "Dear Miriam,\n\nThe bank closed its doors yesterday. All our savings, everything we put aside for the children's future, is gone. I don't know what we'll do. David says we must trust in God, but I am frightened.\n\nPlease pray for us.\nRuth",
          confidence: 0.91,
        },
      ],
      fullText:
        "Dear Miriam,\n\nThe bank closed its doors yesterday. All our savings, everything we put aside for the children's future, is gone. I don't know what we'll do. David says we must trust in God, but I am frightened.\n\nPlease pray for us.\nRuth",
      verified: true,
    },
    metadata: {
      sender: "Ruth Kaplan",
      recipient: "Miriam Kaplan",
      date: "August 9, 1931",
      location: "Toledo, Ohio",
      description: "Expresses worry about savings during the bank closures.",
      verified: true,
      verifiedBy: "Depression Era Archive",
      verifiedAt: "2024-01-20T16:00:00Z",
    },
    status: "published",
    createdAt: "2024-01-18T15:00:00Z",
  },
  {
    id: "6",
    title: "Letter from Eleanor to Charles",
    images: [
      {
        id: "img-6-1",
        type: "letter_page",
        pageNumber: 1,
        imageUrl: "/src/assets/mock/002-L-12141900-1.jpg",
      },
      {
        id: "img-6-2",
        type: "letter_page",
        pageNumber: 2,
        imageUrl: "/src/assets/mock/002-L-12141900-2.jpg",
      },
      {
        id: "img-6-3",
        type: "envelope_front",
        imageUrl: "/src/assets/mock/002-C-12141900.jpg",
      },
    ],
    transcript: {
      pages: [
        {
          pageNumber: 1,
          text: "My Dearest Charles,\n\nYour last letter brought such joy to my heart. The children ask about you every day. Rationing has been difficult, but we manage. The butter shortage is the hardest on little Tommy.\n\nCome home safe to us.\nYour Eleanor",
          confidence: 0.96,
        },
      ],
      fullText:
        "My Dearest Charles,\n\nYour last letter brought such joy to my heart. The children ask about you every day. Rationing has been difficult, but we manage. The butter shortage is the hardest on little Tommy.\n\nCome home safe to us.\nYour Eleanor",
      verified: true,
    },
    metadata: {
      sender: "Eleanor Brooks",
      recipient: "Charles Brooks",
      date: "November 21, 1944",
      location: "Tacoma, Washington",
      description: "Shares news from home and mentions rationing challenges.",
      verified: true,
    },
    status: "published",
    createdAt: "2024-01-22T10:00:00Z",
  },
  {
    id: "7",
    title: "Letter from Luis to Rosa",
    images: [
      {
        id: "img-7-1",
        type: "letter_page",
        pageNumber: 1,
        imageUrl: "/src/assets/mock/001-L-111888-2.JPG",
      },
      {
        id: "img-7-2",
        type: "envelope_front",
        imageUrl: "/src/assets/mock/001-E-111888.JPG",
      },
    ],
    transcript: {
      pages: [
        {
          pageNumber: 1,
          text: "Querida Rosa,\n\nThe work in the fields is hard and the pay is not steady. Some weeks there is work, some weeks there is nothing. But I am trying my best to send money home.\n\nTe quiero,\nLuis",
          confidence: 0.87,
        },
      ],
      fullText:
        "Querida Rosa,\n\nThe work in the fields is hard and the pay is not steady. Some weeks there is work, some weeks there is nothing. But I am trying my best to send money home.\n\nTe quiero,\nLuis",
      verified: false,
    },
    metadata: {
      sender: "Luis Martinez",
      recipient: "Rosa Martinez",
      date: "May 3, 1958",
      location: "Fresno, California",
      description: "Describes difficulties finding steady agricultural work.",
      verified: false,
    },
    status: "published",
    createdAt: "2024-01-24T12:00:00Z",
  },
  {
    id: "8",
    title: "Letter from Daniel to Robert",
    images: [
      {
        id: "img-8-1",
        type: "letter_page",
        pageNumber: 1,
        imageUrl: "/src/assets/mock/002-L-11131900-2.jpg",
      },
      {
        id: "img-8-2",
        type: "envelope_front",
        imageUrl: "/src/assets/mock/002-C-11131900.jpg",
      },
    ],
    transcript: {
      pages: [
        {
          pageNumber: 1,
          text: "Hey Rob,\n\nLife in Vermont is different than I expected. The people are friendly, but everything feels unfamiliar. Sometimes I wonder if leaving was the right choice. How are things back home?\n\nDan",
          confidence: 0.93,
        },
      ],
      fullText:
        "Hey Rob,\n\nLife in Vermont is different than I expected. The people are friendly, but everything feels unfamiliar. Sometimes I wonder if leaving was the right choice. How are things back home?\n\nDan",
      verified: false,
    },
    metadata: {
      sender: "Daniel Greene",
      recipient: "Robert Greene",
      date: "September 14, 1972",
      location: "Burlington, Vermont",
      description: "Reflects on moving away and adjusting to life.",
      verified: false,
    },
    status: "published",
    createdAt: "2024-01-26T14:00:00Z",
  },
  {
    id: "9",
    title: "Letter from Mary to John",
    images: [
      {
        id: "img-9-1",
        type: "letter_page",
        pageNumber: 1,
        imageUrl: "/src/assets/mock/001-L-111888-3.JPG",
      },
      {
        id: "img-9-2",
        type: "envelope_front",
        imageUrl: "/src/assets/mock/001-E-111888.JPG",
      },
    ],
    transcript: {
      pages: [
        {
          pageNumber: 1,
          text: "Dear John,\n\nI hope this letter finds you in good spirits. The harvest this year has been bountiful, and we are grateful for the mild weather.\n\nYour sister,\nMary",
          confidence: 0.89,
        },
      ],
      fullText:
        "Dear John,\n\nI hope this letter finds you in good spirits. The harvest this year has been bountiful, and we are grateful for the mild weather.\n\nYour sister,\nMary",
      verified: false,
    },
    metadata: {
      sender: "Mary Thompson",
      recipient: "John Thompson",
      date: "October 15, 1895",
      location: "Madison, Wisconsin",
      description: "Discusses the successful harvest season.",
      verified: false,
    },
    status: "needs_review",
    createdAt: "2024-02-01T09:00:00Z",
  },
  {
    id: "10",
    title: "Letter from William to Catherine",
    images: [
      {
        id: "img-10-1",
        type: "letter_page",
        pageNumber: 1,
        imageUrl: "/src/assets/mock/002-L-11131900-3.jpg",
      },
      {
        id: "img-10-2",
        type: "letter_page",
        pageNumber: 2,
        imageUrl: "/src/assets/mock/002-L-12141900-1.jpg",
      },
    ],
    transcript: {
      pages: [
        {
          pageNumber: 1,
          text: "My Dear Catherine,\n\nThe factory has increased production and I am working twelve hour days now. The pay is better but I miss seeing the children.\n\nWith affection,\nWilliam",
          confidence: 0.85,
        },
      ],
      fullText:
        "My Dear Catherine,\n\nThe factory has increased production and I am working twelve hour days now. The pay is better but I miss seeing the children.\n\nWith affection,\nWilliam",
      verified: false,
    },
    metadata: {
      sender: "William Harrison",
      recipient: "Catherine Harrison",
      date: "March 22, 1912",
      location: "Detroit, Michigan",
      description: "Mentions long work hours at the factory.",
      verified: false,
    },
    status: "needs_review",
    createdAt: "2024-02-02T10:30:00Z",
  },
  {
    id: "11",
    title: "Letter from Sarah to Margaret",
    images: [
      {
        id: "img-11-1",
        type: "letter_page",
        pageNumber: 1,
        imageUrl: "/src/assets/mock/002-L-12141900-4.jpg",
      },
    ],
    transcript: {
      pages: [
        {
          pageNumber: 1,
          text: "Dearest Margaret,\n\nThe news from overseas is troubling. I pray daily that this conflict will end soon and our boys will come home safe.\n\nYour friend,\nSarah",
          confidence: 0.82,
        },
      ],
      fullText:
        "Dearest Margaret,\n\nThe news from overseas is troubling. I pray daily that this conflict will end soon and our boys will come home safe.\n\nYour friend,\nSarah",
      verified: false,
    },
    metadata: {
      sender: "Sarah Bennett",
      recipient: "Margaret Wilson",
      date: "July 8, 1918",
      location: "Richmond, Virginia",
      description: "Expresses concern about the ongoing war.",
      verified: false,
    },
    status: "needs_review",
    createdAt: "2024-02-03T11:00:00Z",
  },
];

// Helper function to get a single letter by ID
export const getLetterById = (id: string): Letter | undefined => {
  return mockLetters.find((letter) => letter.id === id);
};

// Helper function to get summary data for letter cards
export const getLetterSummaries = () => {
  return mockLetters.map((letter) => ({
    id: letter.id,
    title: letter.title,
    date: letter.metadata.date,
    location: letter.metadata.location,
    sender: letter.metadata.sender,
    recipient: letter.metadata.recipient,
    description: letter.metadata.description,
  }));
};