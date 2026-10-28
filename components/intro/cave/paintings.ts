/**
 * What a click on the cave's paintings says: one short line each, every fact checked against the
 * source named beside it. Keys are the empties bake.py puts on the wall at each group's middle.
 */
export const PAINTINGS: Record<string, string> = {
  // Blown pigment: History.com on Fernández-Navarro et al. 2022 ("blowing pigment onto their hands",
  // "through a hollow bone or reed"). Three on a pillar: the French Ministry of Culture's Chauvet
  // site, Panel of the Negative Hand Prints ("three negative hands", "a rocky pillar").
  painting_hands_left: "Hand stencils: paint blown around a hand held to the rock. Chauvet has three on one pillar.",
  // Fernández-Navarro et al. 2022, Journal of Archaeological Science, as reported by History.com and
  // Archaeology magazine: "up to 25 percent" of the stencils in five Spanish caves are child-sized.
  painting_hands_right: "Some are children's hands. In five caves in Spain, up to a quarter of the stencils are child-sized.",
};

/** How near the cursor must be to a group's middle, in metres on the wall, for a click to count. */
export const PAINTING_REACH = 0.5;
