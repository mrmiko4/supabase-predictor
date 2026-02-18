import WingoPanel from "@/components/WingoPanel";

const Index = () => {
  return (
    <>
      <iframe
        src="https://dkwin0.web.app/#/register?invitationCode=65862531031"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          border: "none",
          zIndex: 1,
        }}
      />
      <WingoPanel />
    </>
  );
};

export default Index;
